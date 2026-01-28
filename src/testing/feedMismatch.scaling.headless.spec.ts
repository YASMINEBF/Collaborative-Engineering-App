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

function buildGraphOnce(graph: any, N: number, avgDeg: number) {
  for (let i = 0; i < N; i++) {
    const id = `c${i}`;
    graph.components.set(id, "equipment", id);
    const c: any = graph.components.get(id);
    c.outputMedium.value = "Water";
    c.inputMedium.value = "Water";
  }

  if (N >= 2) {
    graph.relationships.set("e0", "physical", PhysicalKind.Feeds, "c0", "c1", null, null, null);
  }

  let edgeId = 1;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < avgDeg; k++) {
      const j = (i * 131 + k * 17 + 7) % N;
      if (j === i) continue;
      const id = `e${edgeId++}`;
      graph.relationships.set(id, "physical", PhysicalKind.Feeds, `c${i}`, `c${j}`, null, null, null);
    }
  }

  return edgeId; // approx edge count
}

function countOpenFM(graph: any) {
  let c = 0;
  for (const [, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    const status = conf.status?.value ?? "open";
    if (status === "open" && kind === ConflictKind.FeedMediumMismatch) c++;
  }
  return c;
}

/**
 * IMPORTANT: Clear ALL FeedMediumMismatch conflicts so runs don't accumulate.
 * (Your resolver creates conflicts with random IDs; if you don't clear, you'll leak conflicts.)
 */
function clearFMConflicts(graph: any) {
  const toDelete: string[] = [];
  for (const [id, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    if (kind === ConflictKind.FeedMediumMismatch) toDelete.push(String(id));
  }
  for (const id of toDelete) graph.conflicts.delete(id);
}

test("SCALING (headless): FeedMediumMismatch vs size (single mismatch, heavy scan) - no OOM", async () => {
  test.setTimeout(10 * 60_000);

  const sizes = [200, 500, 1000, 2000]; // start here; add 5000 later if you want
  const avgDeg = 8;
  const WARMUP = 5;
  const K = 30;

  const series: any[] = [];

  for (const N of sizes) {
    const doc = new CRuntime();
    const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

    const edgesApprox = N >= 2 ? 1 + N * avgDeg : 0;
    buildGraphOnce(graph, N, avgDeg);

    const baselineSamples: number[] = [];
    const detectSamples: number[] = [];
    const afterFixSamples: number[] = [];

    const totalRuns = WARMUP + K;

    for (let t = 0; t < totalRuns; t++) {
      // Ensure clean slate for this iteration
      clearFMConflicts(graph);

      // Baseline: consistent graph (c1 input = Water)
      if (N >= 2) {
        const c1: any = graph.components.get("c1");
        c1.inputMedium.value = "Water";
      }

      let t0 = nowMs();
      resolveFeedMediumConflicts(graph as any, "bench");
      let t1 = nowMs();
      const baseMs = t1 - t0;

      if (N >= 2) {
        // Create exactly one mismatch
        const c1: any = graph.components.get("c1");
        c1.inputMedium.value = "Steam";

        t0 = nowMs();
        resolveFeedMediumConflicts(graph as any, "bench");
        t1 = nowMs();
        const detMs = t1 - t0;

        expect(countOpenFM(graph)).toBeGreaterThan(0);

        // Fix mismatch
        c1.inputMedium.value = "Water";

        t0 = nowMs();
        resolveFeedMediumConflicts(graph as any, "bench");
        t1 = nowMs();
        const fixMs = t1 - t0;

        expect(countOpenFM(graph)).toBe(0);

        if (t >= WARMUP) {
          baselineSamples.push(baseMs);
          detectSamples.push(detMs);
          afterFixSamples.push(fixMs);
        }
      } else {
        if (t >= WARMUP) baselineSamples.push(baseMs);
      }

      // Optional: show progress so it never feels “stuck”
      if ((t + 1) % 10 === 0) console.log(`N=${N}: ${t + 1}/${totalRuns}`);
    }

    series.push({
      N,
      avgDeg,
      edgesApprox,
      baseline: summarize(baselineSamples),
      detect: summarize(detectSamples),
      afterFix: summarize(afterFixSamples),
    });

    console.log(`done N=${N}`);
  }

  const out = {
    invariant: "FeedMediumMismatch",
    resolver: "resolveFeedMediumConflicts",
    mode: "scaling_headless_heavy_scan_single_mismatch_reuse_graph",
    timestamp: new Date().toISOString(),
    series,
  };

  const outDir = path.join(process.cwd(), "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "feedMediumMismatch.scaling.headless.sizes.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("Wrote:", outPath);
});
