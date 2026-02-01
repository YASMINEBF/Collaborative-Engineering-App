import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../collabs/model/CEngineeringGraph";
import resolveFeedMediumConflicts from "../collabs/semantics/resolveFeedMediumConflicts";
import { PhysicalKind } from "../models/relationships/enums/RelationshipTypes";
import { ConflictKind } from "../collabs/model/enums/ConflictEnum";
import fs from "fs";
import path from "path";

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function percentile(sorted: number[], p: number) {
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function summarize(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    runs: s.length,
    avgMs: avg,
    minMs: s[0],
    maxMs: s[s.length - 1],
    p50Ms: percentile(s, 0.5),
    p95Ms: percentile(s, 0.95),
  };
}

function clearFeedMediumMismatchConflicts(graph: any) {
  const toDelete: string[] = [];
  for (const [id, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    if (kind === ConflictKind.FeedMediumMismatch || String(kind) === String(ConflictKind.FeedMediumMismatch)) {
      toDelete.push(String(id));
    }
  }
  for (const id of toDelete) graph.conflicts.delete(id);
}

function countOpenFeedMediumMismatchConflicts(graph: any) {
  let c = 0;
  for (const [, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    const status = conf.status?.value ?? "open";
    if ((kind === ConflictKind.FeedMediumMismatch || String(kind) === String(ConflictKind.FeedMediumMismatch)) && status === "open") {
      c++;
    }
  }
  return c;
}

/**
 * Build a big "feeds" graph once.
 * - N equipment nodes, all Water/Water
 * - approx N*avgDeg feeds relationships
 * Returns approx edge count.
 */
function buildFeedsGraphOnce(graph: any, N: number, avgDeg: number) {
  for (let i = 0; i < N; i++) {
    const id = `c${i}`;
    graph.components.set(id, "equipment", id);
    const c: any = graph.components.get(id);
    c.outputMedium.value = "Water";
    c.inputMedium.value = "Water";
  }

  let edgeId = 0;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < avgDeg; k++) {
      const j = (i * 131 + k * 17 + 7) % N; // deterministic pseudo-random
      if (j === i) continue;
      const id = `e${edgeId++}`;
      graph.relationships.set(id, "physical", PhysicalKind.Feeds, `c${i}`, `c${j}`, null, null, null);
    }
  }

  return edgeId;
}

/**
 * Choose C relationships with DISTINCT target ids so we get ~C independent mismatches.
 * Returns array of { relId, srcId, tgtId }.
 */
function pickIndependentPairs(graph: any, C: number) {
  const picked: Array<{ relId: string; srcId: string; tgtId: string }> = [];
  const usedTargets = new Set<string>();

  for (const rel of graph.relationships.values()) {
    const kind = rel.kind?.value ?? rel.kind;
    if (kind !== PhysicalKind.Feeds && String(kind).toLowerCase() !== "feeds") continue;

    const relId = String(rel.id?.value ?? rel.id);
    const srcId = String(rel.sourceId?.value ?? rel.sourceId);
    const tgtId = String(rel.targetId?.value ?? rel.targetId);

    if (!srcId || !tgtId) continue;
    if (usedTargets.has(tgtId)) continue;

    usedTargets.add(tgtId);
    picked.push({ relId, srcId, tgtId });

    if (picked.length >= C) break;
  }

  return picked;
}

test("HEADLESS multiconflict scaling: FeedMediumMismatch detect + afterFix vs #conflicts", async () => {
  test.setTimeout(10 * 60_000);

  // One fixed workload size (keep it stable so only C changes)
  const N = 1000;
  const avgDeg = 8; // ~8000 edges
  const conflictsSweep = [1, 5, 10, 25, 50, 100, 200];
  const WARMUP = 5;
  const K = 30;

  // Build graph once
  const doc = new CRuntime();
  const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));
  const edges = buildFeedsGraphOnce(graph as any, N, avgDeg);

  // Precompute a big pool so we can slice for smaller C
  const pool = pickIndependentPairs(graph as any, Math.max(...conflictsSweep));
  if (pool.length < Math.max(...conflictsSweep)) {
    throw new Error(`Not enough independent pairs. Needed ${Math.max(...conflictsSweep)} got ${pool.length}.`);
  }

  const series: any[] = [];

  for (const C of conflictsSweep) {
    const pairs = pool.slice(0, C);

    const baselineSamples: number[] = [];
    const detectSamples: number[] = [];
    const afterFixSamples: number[] = [];

    const totalRuns = WARMUP + K;

    for (let t = 0; t < totalRuns; t++) {
      // Clean slate
      clearFeedMediumMismatchConflicts(graph as any);

      // Ensure fully consistent start
      for (const { srcId, tgtId } of pairs) {
        const src: any = graph.components.get(srcId);
        const tgt: any = graph.components.get(tgtId);
        if (src?.outputMedium) src.outputMedium.value = "Water";
        if (tgt?.inputMedium) tgt.inputMedium.value = "Water";
      }

      // Baseline: consistent graph
      let t0 = nowMs();
      resolveFeedMediumConflicts(graph as any, "bench");
      let t1 = nowMs();
      const baseMs = t1 - t0;

      // Inject C mismatches: set each target input to Steam (source stays Water)
      for (const { tgtId } of pairs) {
        const tgt: any = graph.components.get(tgtId);
        if (tgt?.inputMedium) tgt.inputMedium.value = "Steam";
      }

      // Detect
      t0 = nowMs();
      resolveFeedMediumConflicts(graph as any, "bench");
      t1 = nowMs();
      const detMs = t1 - t0;

      const open1 = countOpenFeedMediumMismatchConflicts(graph as any);
      // We expect at least C conflicts, but depending on your resolver dedup logic it could be exactly C.
      // We'll assert ">= C" to be safe.
      expect(open1).toBeGreaterThanOrEqual(C);

      // Fix: make targets match sources (Water)
      for (const { tgtId } of pairs) {
        const tgt: any = graph.components.get(tgtId);
        if (tgt?.inputMedium) tgt.inputMedium.value = "Water";
      }

      // After-fix detect
      t0 = nowMs();
      resolveFeedMediumConflicts(graph as any, "bench");
      t1 = nowMs();
      const fixMs = t1 - t0;

      const open2 = countOpenFeedMediumMismatchConflicts(graph as any);
      expect(open2).toBe(0);

      if (t >= WARMUP) {
        baselineSamples.push(baseMs);
        detectSamples.push(detMs);
        afterFixSamples.push(fixMs);
      }

      if ((t + 1) % 10 === 0) console.log(`C=${C}: ${t + 1}/${totalRuns}`);
    }

    series.push({
      conflicts: C,
      N,
      avgDeg,
      edgesApprox: edges,
      baseline: summarize(baselineSamples),
      detect: summarize(detectSamples),
      afterFix: summarize(afterFixSamples),
    });

    console.log(`done C=${C}`);
  }

  const out = {
    invariant: "FeedMediumMismatch",
    resolver: "resolveFeedMediumConflicts",
    mode: "headless_multiconflict_scaling_fixed_graph",
    timestamp: new Date().toISOString(),
    fixed: { N, avgDeg, edgesApprox: edges },
    series,
  };

  const outDir = path.join(process.cwd(), "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "feedMediumMismatch.multiconflict.headless.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("Wrote:", outPath);
});
