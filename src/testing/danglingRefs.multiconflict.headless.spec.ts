import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../collabs/model/CEngineeringGraph";
import resolveDanglingReferences from "../collabs/semantics/resolveDanglingReferences";
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

function clearDanglingConflicts(graph: any) {
  const toDelete: string[] = [];
  for (const [id, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    if (kind === ConflictKind.DanglingReference || String(kind) === String(ConflictKind.DanglingReference)) {
      toDelete.push(String(id));
    }
  }
  for (const id of toDelete) graph.conflicts.delete(id);
}

function countOpenDangling(graph: any) {
  let c = 0;
  for (const [, conf] of graph.conflicts.entries()) {
    const kind = conf.kind?.value ?? conf.kind;
    const status = conf.status?.value ?? "open";
    if (
      (kind === ConflictKind.DanglingReference || String(kind) === String(ConflictKind.DanglingReference)) &&
      status === "open"
    ) {
      c++;
    }
  }
  return c;
}

/**
 * Build a fixed graph once:
 * - CORE nodes that we never delete (to keep scan cost stable)
 * - CANDIDATE nodes that each appear in exactly ONE relationship
 *   so deleting them creates exactly one dangling reference each.
 */
function buildFixedGraph(graph: any, coreN: number, candN: number, coreEdgesPerNode: number) {
  // core components c0..c{coreN-1}
  for (let i = 0; i < coreN; i++) {
    const id = `core${i}`;
    graph.components.set(id, "equipment", id);
  }

  // candidate components d0..d{candN-1}
  for (let i = 0; i < candN; i++) {
    const id = `dang${i}`;
    graph.components.set(id, "equipment", id);
  }

  let edgeId = 0;

  // lots of edges among core nodes (stable scan cost, never dangling)
  for (let i = 0; i < coreN; i++) {
    for (let k = 0; k < coreEdgesPerNode; k++) {
      const j = (i * 131 + k * 17 + 7) % coreN;
      if (j === i) continue;
      const id = `e${edgeId++}`;
      graph.relationships.set(id, "physical", PhysicalKind.Feeds, `core${i}`, `core${j}`, null, null, null);
    }
  }

  // ONE edge per candidate node: core0 -> dang{i}
  // Each candidate appears only here, so deleting it creates exactly 1 dangling conflict.
  for (let i = 0; i < candN; i++) {
    const id = `dedge${i}`;
    graph.relationships.set(id, "physical", PhysicalKind.Feeds, "core0", `dang${i}`, null, null, null);
    edgeId++;
  }

  return { edgesApprox: edgeId };
}

test("HEADLESS multiconflict scaling: DanglingReference vs #dangling conflicts (fixed graph)", async () => {
  test.setTimeout(10 * 60_000);

  const coreN = 1000;
  const candN = 300; // must be >= max(C) in sweep
  const coreEdgesPerNode = 8; // ~8000 + 300 candidate edges
  const conflictsSweep = [1, 5, 10, 25, 50, 100, 200];

  const WARMUP = 5;
  const K = 30;

  const doc = new CRuntime();
  const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

  const { edgesApprox } = buildFixedGraph(graph as any, coreN, candN, coreEdgesPerNode);

  const series: any[] = [];

  for (const C of conflictsSweep) {
    if (C > candN) throw new Error(`C=${C} exceeds candN=${candN}. Increase candN.`);

    const baselineSamples: number[] = [];
    const detectSamples: number[] = [];
    const afterFixSamples: number[] = [];

    const totalRuns = WARMUP + K;

    for (let t = 0; t < totalRuns; t++) {
      clearDanglingConflicts(graph as any);

      // Ensure all candidate components exist before baseline
      for (let i = 0; i < C; i++) {
        const id = `dang${i}`;
        if (!graph.components.get(id)) {
          graph.components.set(id, "equipment", id);
        }
      }

      // Baseline (no dangling)
      let t0 = nowMs();
      resolveDanglingReferences(graph as any, "bench");
      let t1 = nowMs();
      const baseMs = t1 - t0;

      // Inject dangling refs by deleting first C candidate components
      for (let i = 0; i < C; i++) {
        const id = `dang${i}`;
        if (graph.components.get(id)) graph.components.delete(id);
      }

      // Detect
      t0 = nowMs();
      resolveDanglingReferences(graph as any, "bench");
      t1 = nowMs();
      const detMs = t1 - t0;

      const open1 = countOpenDangling(graph as any);
      expect(open1).toBeGreaterThanOrEqual(C);

      // Fix: recreate the deleted components
      for (let i = 0; i < C; i++) {
        const id = `dang${i}`;
        if (!graph.components.get(id)) graph.components.set(id, "equipment", id);
      }

      // After-fix
      t0 = nowMs();
      resolveDanglingReferences(graph as any, "bench");
      t1 = nowMs();
      const fixMs = t1 - t0;

      const open2 = countOpenDangling(graph as any);
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
      fixed: { coreN, candN, coreEdgesPerNode, edgesApprox },
      baseline: summarize(baselineSamples),
      detect: summarize(detectSamples),
      afterFix: summarize(afterFixSamples),
    });

    console.log(`done C=${C}`);
  }

  const out = {
    invariant: "DanglingReference",
    resolver: "resolveDanglingReferences",
    mode: "headless_multiconflict_scaling_fixed_graph",
    timestamp: new Date().toISOString(),
    fixed: { coreN, candN, coreEdgesPerNode, edgesApprox },
    series,
  };

  const outDir = path.join(process.cwd(), "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "danglingReferences.multiconflict.headless.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("Wrote:", outPath);
});
