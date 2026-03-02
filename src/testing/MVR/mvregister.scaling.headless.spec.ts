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

test("SCALING (headless): MVRegister detection vs graph size", async () => {
  test.setTimeout(10 * 60_000);

  const sizes = [200, 500, 1000, 2000];
  const KEY = "attr:testKey";
  const WARMUP = 5;
  const K = 30;

  const series: any[] = [];

  for (const N of sizes) {
    const docA = new CRuntime();
    const graphA = docA.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));
    buildGraphOnce(graphA as any, N);
    await new Promise(r => setTimeout(r, 0));

    const savedState = docA.save();
    const docB = new CRuntime();
    const graphB = docB.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));
    docB.load(savedState);

    const detectSamples: number[] = [];
    const resolutionSamples: number[] = [];

    const totalRuns = WARMUP + K;

    for (let t = 0; t < totalRuns; t++) {
      // Concurrent writes on c0 only — single conflict, fixed regardless of N
      const cA: any = graphA.components.get("c0");
      const cB: any = graphB.components.get("c0");
      cA.attrs.set(KEY, { value: "A", run: t });
      await new Promise(r => setTimeout(r, 0));
      cB.attrs.set(KEY, { value: "B", run: t });
      await new Promise(r => setTimeout(r, 0));

      const stateA = docA.save();
      const stateB = docB.save();
      await new Promise(r => setTimeout(r, 0));

      // Merge outside measurement
      docA.load(stateB);
      docB.load(stateA);
      await new Promise(r => setTimeout(r, 0));

      // Measure detection: scan ALL N components to find conflicts
      // simulating what the real resolver does
      const t0Det = nowMs();
      let totalCandidates = 0;
      for (let i = 0; i < N; i++) {
        const comp: any = graphA.components.get(`c${i}`);
        const candidates = comp?.attrs?.getConflicts(KEY) ?? [];
        totalCandidates += candidates.length;
      }
      const t1Det = nowMs();

      // Only c0 has 2 candidates, all others have 0 or 1
      expect(totalCandidates).toBe(2);

      // Measure resolution: only c0 needs resolving
      const comp0: any = graphA.components.get("c0");
      const candidates = comp0.attrs.getConflicts(KEY);
      const chosen = candidates[t % 2];
      const t0Res = nowMs();
      comp0.attrs.set(KEY, chosen);
      const t1Res = nowMs();

      // Sync resolution outside measurement
      await new Promise(r => setTimeout(r, 0));
      const stateAResolved = docA.save();
      docB.load(stateAResolved);
      await new Promise(r => setTimeout(r, 0));

      // Correctness check
      expect(comp0.attrs.getConflicts(KEY).length).toBeLessThanOrEqual(1);
      const comp0B: any = graphB.components.get("c0");
      expect(comp0B.attrs.getConflicts(KEY).length).toBeLessThanOrEqual(1);

      if (t >= WARMUP) {
        detectSamples.push(t1Det - t0Det);
        resolutionSamples.push(t1Res - t0Res);
      }

      if ((t + 1) % 10 === 0) console.log(`N=${N}: ${t + 1}/${totalRuns}`);
    }

    series.push({
      N,
      componentsCount: N,
      detect: summarize(detectSamples),
      resolution: summarize(resolutionSamples),
    });

    console.log(`done N=${N}`);
  }

  const out = {
    invariant: "MVRegister",
    resolver: "CValueMap.getConflicts + attrs.set",
    mode: "scaling_headless_graph_size_full_scan_single_conflict",
    timestamp: new Date().toISOString(),
    series,
  };

  const outDir = path.join(process.cwd(), "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "mvregister.scaling.headless.sizes.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("Wrote:", outPath);
});