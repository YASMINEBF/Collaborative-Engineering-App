import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

declare global {
  interface Window {
    __CE_TEST_API__: any;
  }
}

/**
 * Deterministic fixture generator:
 * - N equipment nodes: c0..c{N-1}
 * - If N>=2: exactly ONE feeds relationship e0: c0 -> c1
 * - By default: output/input = Water/Water for all nodes
 * - Mismatch toggling is done in the test by editing c1.inputMedium.
 */
function makeGraph(N: number) {
  const nodes: any[] = [];
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: `c${i}`,
      type: "equipment",
      name: `node-${i}`,
      position: { x: i * 10, y: 0 },
      attrs: {
        inputMedium: "Water",
        outputMedium: "Water",
      },
    });
  }

  const edges: any[] = [];
  if (N >= 2) {
    edges.push({
      id: "e0",
      kind: "feeds",
      source: "c0",
      target: "c1",
      medium: null,
    });
  }

  return {
    version: 1,
    meta: { generatedAt: Date.now(), N },
    nodes,
    edges,
  };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

test.describe("BENCH scaling: FeedMediumMismatch N=1..200 (single conflict)", () => {
  // 200 sizes * 10 runs each => 2000 resolver runs + sync ticks
  test.setTimeout(15 * 60_000);

  test("scaling curve (median of 10 runs per N)", async ({ browser }) => {
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    await ctx1.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));
    await ctx2.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await Promise.all([page1.goto(appUrl), page2.goto(appUrl)]);

    await page1.waitForFunction(() => (window as any).__CE_TEST_API__ !== undefined, null, { timeout: 30_000 });
    await page2.waitForFunction(() => (window as any).__CE_TEST_API__ !== undefined, null, { timeout: 30_000 });

    const K = 10; // runs per N
    const series: Array<{ N: number; detectMs: number; afterFixMs: number | null }> = [];

    for (let N = 1; N <= 200; N++) {
      const g = makeGraph(N);

      // Import fresh graph (your importGraph should clear components/relationships/conflicts)
      const ok = await page1.evaluate((gg) => (window as any).__CE_TEST_API__.importGraph(gg), g);
      if (!ok) throw new Error(`importGraph failed for N=${N}`);

      // Let both replicas settle
      await page1.evaluate(() => window.__CE_TEST_API__.flush());
      await page2.evaluate(() => window.__CE_TEST_API__.flush());
      await page1.evaluate(() => window.__CE_TEST_API__.flush());

      // Defensive clear (in case an older importGraph is still in your build)
      await page1.evaluate(() => window.__CE_TEST_API__.clearConflicts?.());
      await page1.evaluate(() => window.__CE_TEST_API__.flush());

      if (N < 2) {
        // No relationship => no mismatch possible
        const t = await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("bench-detect"));
        series.push({ N, detectMs: Number(t?.ms ?? 0), afterFixMs: null });
        continue;
      }

      const detectSamples: number[] = [];
      const afterFixSamples: number[] = [];

      // Ensure our starting state is "no mismatch": c1.input = Water
      await page1.evaluate(() => window.__CE_TEST_API__.bulkEditInput(["c1"], "Water"));
      await page1.evaluate(() => window.__CE_TEST_API__.flush());
      await page2.evaluate(() => window.__CE_TEST_API__.flush());
      await page1.evaluate(() => window.__CE_TEST_API__.flush());

      // Ensure no conflict for e0
      await page1.evaluate(() => window.__CE_TEST_API__.clearFeedMediumMismatchForRel?.("e0"));
      await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("warmup"));
      const startCount = await page1.evaluate(() => window.__CE_TEST_API__.getFeedMediumMismatchCountForRel?.("e0") ?? 0);
      if (startCount !== 0) {
        const snap = await page1.evaluate(() => window.__CE_TEST_API__.snapshot());
        throw new Error(`N=${N}: expected 0 conflicts for e0 at start; got ${startCount}. Snapshot: ${JSON.stringify(snap)}`);
      }

      for (let k = 0; k < K; k++) {
        // --- Create exactly ONE mismatch (single conflict candidate): c1.input != c0.output ---
        await page1.evaluate(() => window.__CE_TEST_API__.bulkEditInput(["c1"], "Steam"));

        // settle delivery
        await page1.evaluate(() => window.__CE_TEST_API__.flush());
        await page2.evaluate(() => window.__CE_TEST_API__.flush());
        await page1.evaluate(() => window.__CE_TEST_API__.flush());

        // --- Detect (timed) ---
        const detect = await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("bench-detect"));
        detectSamples.push(Number(detect?.ms ?? 0));

        // correctness: conflict must exist for rel e0
        const c1 = await page1.evaluate(() => window.__CE_TEST_API__.getFeedMediumMismatchCountForRel("e0"));
        if (!(c1 > 0)) {
          const snap = await page1.evaluate(() => window.__CE_TEST_API__.snapshot());
          throw new Error(`N=${N}: expected conflict for e0 after detect; got ${c1}. Snapshot: ${JSON.stringify(snap)}`);
        }

        // --- Fix mismatch ---
        await page1.evaluate(() => window.__CE_TEST_API__.bulkEditInput(["c1"], "Water"));

        await page1.evaluate(() => window.__CE_TEST_API__.flush());
        await page2.evaluate(() => window.__CE_TEST_API__.flush());
        await page1.evaluate(() => window.__CE_TEST_API__.flush());

        // --- Detect-after-fix (timed) ---
        const afterFix = await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("bench-afterfix"));
        afterFixSamples.push(Number(afterFix?.ms ?? 0));

        const c2 = await page1.evaluate(() => window.__CE_TEST_API__.getFeedMediumMismatchCountForRel("e0"));
        if (c2 !== 0) {
          const snap = await page1.evaluate(() => window.__CE_TEST_API__.snapshot());
          throw new Error(`N=${N}: expected 0 conflicts for e0 after fix; got ${c2}. Snapshot: ${JSON.stringify(snap)}`);
        }

        // Extra safety: remove any duplicate conflicts for e0 so next iteration is clean
        await page1.evaluate(() => window.__CE_TEST_API__.clearFeedMediumMismatchForRel?.("e0"));
        await page1.evaluate(() => window.__CE_TEST_API__.flush());
      }

      series.push({
        N,
        detectMs: median(detectSamples),
        afterFixMs: median(afterFixSamples),
      });
    }

    const out = {
      invariant: "FeedMediumMismatch",
      resolver: "resolveFeedMediumConflicts",
      mode: "scaling_median10_per_N_single_conflict",
      runsPerN: 10,
      series,
      timestamp: new Date().toISOString(),
    };

    const outDir = path.join(process.cwd(), "benchmark-results");
    fs.mkdirSync(outDir, { recursive: true });

    const outJson = path.join(outDir, "feedMediumMismatch.scaling.N1-200.median10.json");
    fs.writeFileSync(outJson, JSON.stringify(out, null, 2), "utf-8");

    const outCsv = path.join(outDir, "feedMediumMismatch.scaling.N1-200.median10.csv");
    const csvLines = ["N,detectMs,afterFixMs"];
    for (const row of series) csvLines.push(`${row.N},${row.detectMs},${row.afterFixMs ?? ""}`);
    fs.writeFileSync(outCsv, csvLines.join("\n"), "utf-8");

    console.log("Wrote:", outJson);
    console.log("Wrote:", outCsv);

    await ctx1.close();
    await ctx2.close();
  });
});
