import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../../collabs/model/CEngineeringGraph";
import fs from "fs";
import path from "path";

const RUNS = 200;

test("MV-register: detection and resolution latency (200 runs)", async () => {
  const detectionLatencies: number[] = [];
  const resolutionLatencies: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const docA = new CRuntime();
    const graphA = docA.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));
    const docB = new CRuntime();
    const graphB = docB.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

    const compId = "c0";
    const KEY = "attr:testKey";

    graphA.components.set(compId, "equipment", "TestComp");
    await new Promise(r => setTimeout(r, 0));

    const savedState = docA.save();
    docB.load(savedState);

    const compA: any = graphA.components.get(compId);
    const compB: any = graphB.components.get(compId);

    compA.attrs.set(KEY, { value: "A", run: i });
    await new Promise(r => setTimeout(r, 0));
    compB.attrs.set(KEY, { value: "B", run: i });
    await new Promise(r => setTimeout(r, 0));

    const stateA = docA.save();
    const stateB = docB.save();
    await new Promise(r => setTimeout(r, 0));

    // Merge outside the measurement window
    docA.load(stateB);
    docB.load(stateA);
    await new Promise(r => setTimeout(r, 0));

    // Measure ONLY the detection call
    const t0Detection = performance.now();
    const candidatesA = compA.attrs.getConflicts(KEY);
    const t1Detection = performance.now();

    expect(candidatesA.length).toBe(2);
    detectionLatencies.push(t1Detection - t0Detection);

    // Measure ONLY the resolution call
    const chosen = candidatesA[i % 2];
    const t0Resolution = performance.now();
    compA.attrs.set(KEY, chosen);
    const t1Resolution = performance.now();

    resolutionLatencies.push(t1Resolution - t0Resolution);

    // Sync after, outside the measurement window
    await new Promise(r => setTimeout(r, 0));
    const stateAResolved = docA.save();
    docB.load(stateAResolved);
    await new Promise(r => setTimeout(r, 0));

    const candidatesAAfter = compA.attrs.getConflicts(KEY);
    const candidatesBAfter = compB.attrs.getConflicts(KEY);

    expect(candidatesAAfter.length).toBeLessThanOrEqual(1);
    expect(candidatesBAfter.length).toBeLessThanOrEqual(1);
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = (arr: number[]) => Math.min(...arr);
  const max = (arr: number[]) => Math.max(...arr);
  const p50 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.50)];
  };
  const p95 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  };

  console.log("=== Detection Latency (ms) ===");
  console.log(`  avg: ${avg(detectionLatencies).toFixed(3)}`);
  console.log(`  min: ${min(detectionLatencies).toFixed(3)}`);
  console.log(`  max: ${max(detectionLatencies).toFixed(3)}`);
  console.log(`  p95: ${p95(detectionLatencies).toFixed(3)}`);

  console.log("=== Resolution Latency (ms) ===");
  console.log(`  avg: ${avg(resolutionLatencies).toFixed(3)}`);
  console.log(`  min: ${min(resolutionLatencies).toFixed(3)}`);
  console.log(`  max: ${max(resolutionLatencies).toFixed(3)}`);
  console.log(`  p95: ${p95(resolutionLatencies).toFixed(3)}`);

  const out = {
    detect: {
      avgMs: avg(detectionLatencies),
      p50Ms: p50(detectionLatencies),
      p95Ms: p95(detectionLatencies),
      minMs: min(detectionLatencies),
      maxMs: max(detectionLatencies),
    },
    resolution: {
      avgMs: avg(resolutionLatencies),
      p50Ms: p50(resolutionLatencies),
      p95Ms: p95(resolutionLatencies),
      minMs: min(resolutionLatencies),
      maxMs: max(resolutionLatencies),
    },
  };

  fs.mkdirSync("benchmark-results", { recursive: true });
  fs.writeFileSync(
    path.join("benchmark-results", "mvregister.json"),
    JSON.stringify(out, null, 2)
  );

  expect(avg(detectionLatencies)).toBeLessThan(10);
  expect(avg(resolutionLatencies)).toBeLessThan(10);
});