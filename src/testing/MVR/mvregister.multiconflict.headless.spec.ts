import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../../collabs/model/CEngineeringGraph";
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

function buildGraphOnce(graph: any, N: number) {
  for (let i = 0; i < N; i++) {
    graph.components.set(`c${i}`, "equipment", `node-${i}`);
  }
}

test("HEADLESS multiconflict scaling: MVRegister detect vs #conflicts", async () => {
  test.setTimeout(10 * 60_000);

  const N = 1000;
  const conflictsSweep = [1, 5, 10, 25, 50, 100, 200];
  const WARMUP = 5;
  const K = 30;

  const series: any[] = [];

  for (const C of conflictsSweep) {
    const docA = new CRuntime();
    const graphA = docA.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));
    buildGraphOnce(graphA as any, N);
    await new Promise(r => setTimeout(r, 0));

    const savedState = docA.save();
    const docB = new CRuntime();
    const graphB = docB.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));
    docB.load(savedState);

    // C conflicting keys, all on c0
    const keys = Array.from({ length: C }, (_, i) => `attr:key-${i}`);

    const detectSamples: number[] = [];
    const resolutionSamples: number[] = [];

    const totalRuns = WARMUP + K;

    for (let t = 0; t < totalRuns; t++) {
      // Write C concurrent conflicts on c0 only
      const compA: any = graphA.components.get("c0");
      const compB: any = graphB.components.get("c0");

      for (const key of keys) {
        compA.attrs.set(key, { value: "A", run: t });
      }
      await new Promise(r => setTimeout(r, 0));

      for (const key of keys) {
        compB.attrs.set(key, { value: "B", run: t });
      }
      await new Promise(r => setTimeout(r, 0));

      const stateA = docA.save();
      const stateB = docB.save();
      await new Promise(r => setTimeout(r, 0));

      // Merge outside measurement
      docA.load(stateB);
      docB.load(stateA);
      await new Promise(r => setTimeout(r, 0));

      // Measure detection: scan ALL N components for all C keys
      // simulating what the real resolver does
      const t0Det = nowMs();
      let totalCandidates = 0;
      for (let i = 0; i < N; i++) {
        const comp: any = graphA.components.get(`c${i}`);
        for (const key of keys) {
          const candidates = comp?.attrs?.getConflicts(key) ?? [];
          totalCandidates += candidates.length;
        }
      }
      const t1Det = nowMs();

      // Only c0 has conflicts, all others return 0 or 1
      expect(totalCandidates).toBe(C * 2);

      // Measure resolution: only c0 needs resolving — O(C)
      const t0Res = nowMs();
      for (const key of keys) {
        const candidates = compA.attrs.getConflicts(key);
        compA.attrs.set(key, candidates[t % 2]);
      }
      const t1Res = nowMs();

      // Sync outside measurement
      await new Promise(r => setTimeout(r, 0));
      const stateAResolved = docA.save();
      docB.load(stateAResolved);
      await new Promise(r => setTimeout(r, 0));

      // Correctness check
      for (const key of keys) {
        expect(compA.attrs.getConflicts(key).length).toBeLessThanOrEqual(1);
        const comp0B: any = graphB.components.get("c0");
        expect(comp0B.attrs.getConflicts(key).length).toBeLessThanOrEqual(1);
      }

      if (t >= WARMUP) {
        detectSamples.push(t1Det - t0Det);
        resolutionSamples.push(t1Res - t0Res);
      }

      if ((t + 1) % 10 === 0) console.log(`C=${C}: ${t + 1}/${totalRuns}`);
    }

    series.push({
      conflicts: C,
      N,
      detect: summarize(detectSamples),
      resolution: summarize(resolutionSamples),
    });

    console.log(`done C=${C}`);
  }

  const out = {
    invariant: "MVRegister",
    resolver: "CValueMap.getConflicts + attrs.set",
    mode: "headless_multiconflict_scaling_fixed_graph_full_scan",
    timestamp: new Date().toISOString(),
    fixed: { N },
    series,
  };

  const outDir = path.join(process.cwd(), "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "mvregister.multiconflict.headless.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("Wrote:", outPath);
});