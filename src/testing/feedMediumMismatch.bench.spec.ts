import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../collabs/model/CEngineeringGraph";
import { PhysicalKind } from "../models/relationships/enums/RelationshipTypes";
import resolveFeedMediumConflicts from "../collabs/semantics/resolveFeedMediumConflicts";
import { ConflictKind } from "../collabs/model/enums/ConflictEnum";
import { findFeedMediumMismatches, getOpenConflictsByKind } from "./helpers/invariants";
import fs from "fs";
import path from "path";

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function percentile(sorted: number[], p: number) {
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    runs: samples.length,
    avgMs: avg,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

test("BENCH Invariant #8: detect + detect-after-fix latency", async () => {
  const RUNS = 200;
  const detectSamples: number[] = [];
  const afterFixSamples: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const doc = new CRuntime();
    const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

    const aId = `A-${i}-${Date.now()}`;
    const bId = `B-${i}-${Date.now()}`;
    const relId = `R-${i}-${Date.now()}`;

    graph.components.set(aId, "equipment", `EqA-${i}`);
    graph.components.set(bId, "equipment", `EqB-${i}`);

    const A: any = graph.components.get(aId);
    const B: any = graph.components.get(bId);
    A.outputMedium.value = "Water";
    B.inputMedium.value = "Steam";

    graph.relationships.set(relId, "physical", PhysicalKind.Feeds, aId, bId, null, null, null);

    // Detect
    const t0 = nowMs();
    resolveFeedMediumConflicts(graph as any, "bench");
    detectSamples.push(nowMs() - t0);

    const open1 = getOpenConflictsByKind(graph, ConflictKind.FeedMediumMismatch);
    expect(open1.length).toBeGreaterThan(0);

    // Fix (simulate user choice)
    B.inputMedium.value = A.outputMedium.value;

    // Detect-after-fix
    const t1 = nowMs();
    resolveFeedMediumConflicts(graph as any, "bench");
    afterFixSamples.push(nowMs() - t1);

    const open2 = getOpenConflictsByKind(graph, ConflictKind.FeedMediumMismatch);
    expect(open2.length).toBe(0);
  }

  const dStats = stats(detectSamples);
  const fStats = stats(afterFixSamples);

  console.log("FeedMismatch detect stats:", dStats);
  console.log("FeedMismatch after-fix stats:", fStats);

  const out = {
    invariant: "FeedMediumMismatch",
    resolver: "resolveFeedMediumConflicts",
    detect: dStats,
    afterFix: fStats,
    timestamp: new Date().toISOString(),
  };

  const outDir = path.join(process.cwd(), "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "feedMediumMismatch.json"), JSON.stringify(out, null, 2), "utf-8");
});
