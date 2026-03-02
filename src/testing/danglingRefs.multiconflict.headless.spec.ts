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
    if (String(kind) === String(ConflictKind.DanglingReference)) {
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
    if (String(kind) === String(ConflictKind.DanglingReference) && status === "open") c++;
  }
  return c;
}

/**
 * Robust "record deletion" helper for benchmarking.
 *
 * Your resolver only flags missing nodes if graph.deletionLog.get(nodeId) exists.
 * But deletionLog may be a CValueMap with constructor-like set() signatures.
 *
 * This function tries multiple ways to create the entry, then fills fields if present.
 */
function recordDeletion(graph: any, id: string) {
  const dl = graph?.deletionLog;
  if (!dl || typeof dl.get !== "function" || typeof dl.set !== "function") {
    throw new Error(
      "graph.deletionLog is missing or does not support .get/.set. " +
        "This benchmark depends on deletionLog because resolveDanglingReferences checks it."
    );
  }

  const key = String(id);
  const deletedAt = Date.now();

  // 1) Ensure an entry exists (try different set signatures)
  //    - dl.set(key, object)
  //    - dl.set(key) then fill fields
  //    - dl.set(key, type, uniqueName) (common pattern)
  let entry: any = null;

  // If already exists, reuse it
  try {
    entry = dl.get(key);
  } catch {}

  if (!entry) {
    // Try: dl.set(key, {...})
    try {
      dl.set(key, {
        type: "equipment",
        uniqueName: key,
        position: { x: 0, y: 0 },
        deletedAt,
        deletedBy: "bench",
      });
    } catch {}

    try {
      entry = dl.get(key);
    } catch {}

    // Try: dl.set(key)  (constructor with no args)
    if (!entry) {
      try {
        dl.set(key);
      } catch {}
      try {
        entry = dl.get(key);
      } catch {}
    }

    // Try: dl.set(key, type, uniqueName)
    if (!entry) {
      try {
        dl.set(key, "equipment", key);
      } catch {}
      try {
        entry = dl.get(key);
      } catch {}
    }
  }

  // 2) Fill fields if the entry is a Collabs object (common: fields are CVars)
  if (entry && typeof entry === "object") {
    try {
      if (entry.type && "value" in entry.type) entry.type.value = "equipment";
    } catch {}
    try {
      if (entry.uniqueName && "value" in entry.uniqueName) entry.uniqueName.value = key;
    } catch {}
    try {
      if (entry.position && "value" in entry.position) entry.position.value = { x: 0, y: 0 };
    } catch {}
    try {
      if (entry.deletedAt && "value" in entry.deletedAt) entry.deletedAt.value = deletedAt;
    } catch {}
    try {
      if (entry.deletedBy && "value" in entry.deletedBy) entry.deletedBy.value = "bench";
    } catch {}
  }

  // 3) Final sanity check: resolver will call dl.get(key)
  //    If still empty, throw early so you know why open1 stays 0.
  try {
    const check = dl.get(key);
    if (!check) {
      throw new Error(`recordDeletion: deletionLog.get(${key}) is still null after attempting to set it.`);
    }
  } catch (e: any) {
    throw new Error(`recordDeletion failed for ${key}: ${String(e?.message ?? e)}`);
  }
}

/**
 * Benchmark wrapper:
 * - Run real resolver
 * - Then cleanup dangling conflicts that are no longer dangling (node restored OR edge gone),
 *   so "afterFix" can be measured meaningfully.
 */
function resolveDanglingBench(graph: any, user = "bench") {
  resolveDanglingReferences(graph, user);

  const toDelete: string[] = [];
  try {
    for (const [confId, conf] of graph.conflicts.entries()) {
      const kind = conf.kind?.value ?? conf.kind;
      if (String(kind) !== String(ConflictKind.DanglingReference)) continue;

      const idStr = String(confId);
      // your resolver uses: `dangling::node::<nodeId>::edge::<edgeId>`
      const m = idStr.match(/^dangling::node::(.+?)::edge::(.+)$/);
      if (!m) continue;
      const nodeId = m[1];
      const edgeId = m[2];

      const nodeExists = !!graph.components.get(String(nodeId));
      const edgeExists = !!graph.relationships.get(String(edgeId));

      if (nodeExists || !edgeExists) toDelete.push(idStr);
    }
  } catch {}

  for (const id of toDelete) {
    try {
      graph.conflicts.delete(id);
    } catch {}
  }
}

/**
 * Build a fixed graph once:
 * - CORE nodes never deleted
 * - CANDIDATE nodes each appear in exactly ONE relationship: core0 -> dang{i}
 */
function buildFixedGraph(graph: any, coreN: number, candN: number, coreEdgesPerNode: number) {
  for (let i = 0; i < coreN; i++) graph.components.set(`core${i}`, "equipment", `core${i}`);
  for (let i = 0; i < candN; i++) graph.components.set(`dang${i}`, "equipment", `dang${i}`);

  let edgeId = 0;

  for (let i = 0; i < coreN; i++) {
    for (let k = 0; k < coreEdgesPerNode; k++) {
      const j = (i * 131 + k * 17 + 7) % coreN;
      if (j === i) continue;
      graph.relationships.set(
        `e${edgeId++}`,
        "physical",
        PhysicalKind.Feeds,
        `core${i}`,
        `core${j}`,
        null,
        null,
        null
      );
    }
  }

  for (let i = 0; i < candN; i++) {
    graph.relationships.set(
      `dedge${i}`,
      "physical",
      PhysicalKind.Feeds,
      "core0",
      `dang${i}`,
      null,
      null,
      null
    );
    edgeId++;
  }

  return { edgesApprox: edgeId };
}

test("HEADLESS multiconflict scaling: DanglingReference vs #dangling conflicts (fixed graph)", async () => {
  test.setTimeout(10 * 60_000);

  const coreN = 1000;
  const candN = 300;
  const coreEdgesPerNode = 8;
  const conflictsSweep = [1, 5, 10, 25, 50, 100, 200];

  const WARMUP = 5;
  const K = 30;

  const doc = new CRuntime();
  const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

  const { edgesApprox } = buildFixedGraph(graph as any, coreN, candN, coreEdgesPerNode);

  const series: any[] = [];

  for (const C of conflictsSweep) {
    const baselineSamples: number[] = [];
    const detectSamples: number[] = [];
    const afterFixSamples: number[] = [];

    const totalRuns = WARMUP + K;

    for (let t = 0; t < totalRuns; t++) {
      clearDanglingConflicts(graph as any);

      // Ensure candidates exist (baseline should be no dangling)
      for (let i = 0; i < C; i++) {
        const id = `dang${i}`;
        if (!graph.components.get(id)) graph.components.set(id, "equipment", id);
      }

      // Baseline
      let t0 = nowMs();
      resolveDanglingBench(graph as any, "bench");
      let t1 = nowMs();
      const baseMs = t1 - t0;

      // Delete first C candidates (but do it in a way resolver recognizes)
      for (let i = 0; i < C; i++) {
        const id = `dang${i}`;
        if (graph.components.get(id)) {
          recordDeletion(graph as any, id); // key for detection
          graph.components.delete(id);
        }
      }

      // Detect
      t0 = nowMs();
      resolveDanglingBench(graph as any, "bench");
      t1 = nowMs();
      const detMs = t1 - t0;

      const open1 = countOpenDangling(graph as any);
      expect(open1).toBeGreaterThanOrEqual(C);

      // Restore
      for (let i = 0; i < C; i++) {
        const id = `dang${i}`;
        if (!graph.components.get(id)) graph.components.set(id, "equipment", id);
      }

      // After-fix
      t0 = nowMs();
      resolveDanglingBench(graph as any, "bench");
      t1 = nowMs();
      const fixMs = t1 - t0;

      const open2 = countOpenDangling(graph as any);
      expect(open2).toBe(0);

      if (t >= WARMUP) {
        baselineSamples.push(baseMs);
        detectSamples.push(detMs);
        afterFixSamples.push(fixMs);
      }
    }

    series.push({
      conflicts: C,
      fixed: { coreN, candN, coreEdgesPerNode, edgesApprox },
      baseline: summarize(baselineSamples),
      detect: summarize(detectSamples),
      afterFix: summarize(afterFixSamples),
    });
  }

  const out = {
    invariant: "DanglingReference",
    resolver: "resolveDanglingReferences (+bench cleanup)",
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
