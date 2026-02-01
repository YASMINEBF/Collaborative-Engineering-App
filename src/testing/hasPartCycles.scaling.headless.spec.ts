import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../collabs/model/CEngineeringGraph";
import resolveHasPartCycles from "../collabs/semantics/resolveHasPartCycles";
import { StructuralKind } from "../models/relationships/enums/RelationshipTypes";
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

function clearCycleConflicts(graph: any) {
  const toDelete: string[] = [];
  for (const [id, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    if (kind === ConflictKind.CycleDetected || String(kind) === String(ConflictKind.CycleDetected)) {
      toDelete.push(String(id));
    }
  }
  for (const id of toDelete) graph.conflicts.delete(id);
}

function countOpenCycleConflicts(graph: any) {
  let c = 0;
  for (const [, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    const status = conf.status?.value ?? "open";
    if (
      (kind === ConflictKind.CycleDetected || String(kind) === String(ConflictKind.CycleDetected)) &&
      status === "open"
    ) {
      c++;
    }
  }
  return c;
}

/**
 * Build a DAG of HasPart edges:
 * - nodes: c0..c{N-1}
 * - edges: forward-only so it's acyclic
 * Returns the number of structural edges created.
 *
 * IMPORTANT:
 * We create only StructuralKind.HasPart edges so resolveHasPartCycles scans them.
 */
function buildHasPartDAGOnce(graph: any, N: number, forwardDeg: number) {
  // components
  for (let i = 0; i < N; i++) {
    const id = `c${i}`;
    graph.components.set(id, "equipment", id);
  }

  let edgeId = 0;

  // Always include chain edges: c0->c1->...->c{N-1}
  for (let i = 0; i < N - 1; i++) {
    const id = `h${edgeId++}`;
    graph.relationships.set(id, "structural", StructuralKind.HasPart, `c${i}`, `c${i + 1}`, null, null, null);
  }

  // Add extra forward edges to increase branching but keep DAG property (src < tgt)
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < forwardDeg; k++) {
      const j = i + 2 + ((i * 131 + k * 17 + 7) % Math.max(1, N - i - 2));
      if (j >= N) continue;
      const id = `h${edgeId++}`;
      graph.relationships.set(id, "structural", StructuralKind.HasPart, `c${i}`, `c${j}`, null, null, null);
    }
  }

  return edgeId;
}

test("SCALING (headless): HasPart cycle detection vs size (single cycle)", async () => {
  test.setTimeout(10 * 60_000);

  const sizes = [200, 500, 1000, 2000];
  const forwardDeg = 2; // extra forward edges per node (besides the chain)
  const WARMUP = 5;
  const K = 30;

  const series: any[] = [];

  for (const N of sizes) {
    const doc = new CRuntime();
    const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

    const edgesApprox = buildHasPartDAGOnce(graph as any, N, forwardDeg);

    const baselineSamples: number[] = [];
    const detectSamples: number[] = [];
    const afterFixSamples: number[] = [];

    const totalRuns = WARMUP + K;

    // We'll inject exactly ONE back-edge that creates a cycle:
    // c{N-1} -> c{N-2} (since chain includes c{N-2} -> c{N-1})
    const backEdgeId = "cycleEdge";
    const backSrc = `c${N - 1}`;
    const backTgt = `c${N - 2}`;

    for (let t = 0; t < totalRuns; t++) {
      clearCycleConflicts(graph as any);

      // Ensure the back-edge is absent (baseline)
      try {
        if (graph.relationships.get(backEdgeId)) graph.relationships.delete(backEdgeId);
      } catch {}

      // Baseline: acyclic
      let t0 = nowMs();
      resolveHasPartCycles(graph as any, "bench");
      let t1 = nowMs();
      const baseMs = t1 - t0;

      // Inject a single cycle
      graph.relationships.set(backEdgeId, "structural", StructuralKind.HasPart, backSrc, backTgt, null, null, null);

      // Detect
      t0 = nowMs();
      resolveHasPartCycles(graph as any, "bench");
      t1 = nowMs();
      const detMs = t1 - t0;

      expect(countOpenCycleConflicts(graph as any)).toBeGreaterThan(0);

      // Fix: remove the back-edge
      graph.relationships.delete(backEdgeId);

      // After-fix
      t0 = nowMs();
      resolveHasPartCycles(graph as any, "bench");
      t1 = nowMs();
      const fixMs = t1 - t0;

      expect(countOpenCycleConflicts(graph as any)).toBe(0);

      if (t >= WARMUP) {
        baselineSamples.push(baseMs);
        detectSamples.push(detMs);
        afterFixSamples.push(fixMs);
      }

      if ((t + 1) % 10 === 0) console.log(`N=${N}: ${t + 1}/${totalRuns}`);
    }

    series.push({
      N,
      forwardDeg,
      edgesApprox, // approximate #hasPart edges scanned
      baseline: summarize(baselineSamples),
      detect: summarize(detectSamples),
      afterFix: summarize(afterFixSamples),
    });

    console.log(`done N=${N} hasPartEdges=${edgesApprox}`);
  }

  const out = {
    invariant: "HasPartCycleDetected",
    resolver: "resolveHasPartCycles",
    mode: "scaling_headless_single_cycle",
    timestamp: new Date().toISOString(),
    series,
  };

  const outDir = path.join(process.cwd(), "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "hasPartCycles.scaling.headless.sizes.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("Wrote:", outPath);
});
