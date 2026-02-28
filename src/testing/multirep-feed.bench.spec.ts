import { test } from "@playwright/test";
import fs from "fs";
import path from "path";

declare global {
  interface Window {
    __CE_TEST_API__: any;
  }
}

/**
 * Small deterministic fixture:
 * - N equipment nodes: c0..c{N-1}
 * - Star feeds edges: c0 -> c1..c{N-1}  (N-1 edges)
 * - Extra stable edges: ~extraEdges more feeds edges (kept consistent)
 * - All nodes start Water/Water
 */
function makeSmallGraph(N = 60, extraEdges = 60) {
  const nodes: any[] = [];
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: `c${i}`,
      type: "equipment",
      name: `node-${i}`,
      position: { x: (i % 12) * 50, y: Math.floor(i / 12) * 60 },
      attrs: { inputMedium: "Water", outputMedium: "Water" },
    });
  }

  const edges: any[] = [];
  let eid = 0;

  // Star edges: predictable mismatches when we edit c1..cK input
  for (let i = 1; i < N; i++) {
    edges.push({
      id: `e${eid++}`,
      kind: "feeds",
      source: "c0",
      target: `c${i}`,
      medium: null,
    });
  }

  // Extra edges that we keep consistent to simulate more “realistic” graph size
  for (let k = 0; k < extraEdges; k++) {
    const src = (k * 17 + 3) % N;
    let tgt = (k * 31 + 7) % N;
    if (tgt === src) tgt = (tgt + 1) % N;

    // avoid duplicating star edges (c0->ci)
    if (src === 0 && tgt >= 1) continue;

    edges.push({
      id: `e${eid++}`,
      kind: "feeds",
      source: `c${src}`,
      target: `c${tgt}`,
      medium: null,
    });
  }

  return {
    version: 1,
    meta: { generatedAt: Date.now(), N, edges: edges.length },
    nodes,
    edges,
  };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function settleBoth(page1: any, page2: any) {
  // “deliver + apply” in both directions:
  await page1.evaluate(() => window.__CE_TEST_API__.flush?.());
  await page2.evaluate(() => window.__CE_TEST_API__.flush?.());
  await page1.evaluate(() => window.__CE_TEST_API__.flush?.());
}

test.describe("BENCH 2-replica: FeedMediumMismatch (small graph)", () => {
  test.setTimeout(10 * 60_000);

  test("fixed N=60, ~120 edges, 5 mismatches per iter -> CSV/JSON for plotting", async ({
    browser,
  }) => {
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    // Two independent “instances” of the app:
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    await ctx1.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));
    await ctx2.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await Promise.all([page1.goto(appUrl), page2.goto(appUrl)]);

    await Promise.all([
      page1.waitForFunction(() => (window as any).__CE_TEST_API__ !== undefined, null, {
        timeout: 30_000,
      }),
      page2.waitForFunction(() => (window as any).__CE_TEST_API__ !== undefined, null, {
        timeout: 30_000,
      }),
    ]);

    const N = 60;
    const extraEdges = 60; // star=59, total≈119
    const g = makeSmallGraph(N, extraEdges);

    // Import once on page1; page2 should converge via sync.
    const ok = await page1.evaluate((gg) => (window as any).__CE_TEST_API__.importGraph(gg), g);
    if (!ok) throw new Error("importGraph failed");

    await settleBoth(page1, page2);

    // We will intentionally mismatch only these targets each iteration:
    const mismatchTargets = ["c1", "c2", "c3", "c4", "c5"]; // => expect 5 mismatches
    const expectedConflicts = mismatchTargets.length;

    // Ensure clean start
    await page1.evaluate((ids) => window.__CE_TEST_API__.bulkEditInput(ids, "Water"), mismatchTargets);
    await settleBoth(page1, page2);

    await page1.evaluate(() => window.__CE_TEST_API__.clearConflicts?.());
    await settleBoth(page1, page2);

    const WARMUP = 10;
    const RUNS = 100;

    const rows: Array<{
      iter: number;
      phase: "detect" | "afterfix";
      page: 1 | 2;
      ms: number;
      conflicts: number;
    }> = [];

    // We time on both pages to show convergence + comparable compute cost
    for (let i = 0; i < WARMUP + RUNS; i++) {
      const measured = i >= WARMUP;
      const iter = i - WARMUP;

      // --- Introduce mismatches on page1 (simulating user edit on replica 1) ---
      await page1.evaluate((ids) => window.__CE_TEST_API__.bulkEditInput(ids, "Steam"), mismatchTargets);
      await settleBoth(page1, page2);

      // --- Detect (timed) on BOTH replicas ---
      const d1 = await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("bench-detect-p1"));
      const c1 = await page1.evaluate(() => window.__CE_TEST_API__.getFeedMediumMismatchCount());
      const d2 = await page2.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("bench-detect-p2"));
      const c2 = await page2.evaluate(() => window.__CE_TEST_API__.getFeedMediumMismatchCount());

      // correctness check (don’t hide bugs):
      // We expect at least the mismatches we created. (If your resolver can create >5 due to other structure, keep >=.)
      if (c1 < expectedConflicts || c2 < expectedConflicts) {
        const snap1 = await page1.evaluate(() => window.__CE_TEST_API__.snapshot?.());
        const snap2 = await page2.evaluate(() => window.__CE_TEST_API__.snapshot?.());
        throw new Error(
          `detect: expected conflicts>=${expectedConflicts}, got page1=${c1}, page2=${c2}\n` +
            `snap1=${JSON.stringify(snap1)}\n` +
            `snap2=${JSON.stringify(snap2)}`
        );
      }

      // --- Fix mismatches on page1 (simulating resolution on replica 1) ---
      await page1.evaluate((ids) => window.__CE_TEST_API__.bulkEditInput(ids, "Water"), mismatchTargets);
      await settleBoth(page1, page2);

      // --- Detect-after-fix (timed) on BOTH replicas ---
      const f1 = await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("bench-afterfix-p1"));
      const c1a = await page1.evaluate(() => window.__CE_TEST_API__.getFeedMediumMismatchCount());
      const f2 = await page2.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("bench-afterfix-p2"));
      const c2a = await page2.evaluate(() => window.__CE_TEST_API__.getFeedMediumMismatchCount());

      if (c1a !== 0 || c2a !== 0) {
        const snap1 = await page1.evaluate(() => window.__CE_TEST_API__.snapshot?.());
        const snap2 = await page2.evaluate(() => window.__CE_TEST_API__.snapshot?.());
        throw new Error(
          `afterfix: expected 0 conflicts, got page1=${c1a}, page2=${c2a}\n` +
            `snap1=${JSON.stringify(snap1)}\n` +
            `snap2=${JSON.stringify(snap2)}`
        );
      }

      if (measured) {
        rows.push({ iter, phase: "detect", page: 1, ms: Number(d1?.ms ?? 0), conflicts: c1 });
        rows.push({ iter, phase: "detect", page: 2, ms: Number(d2?.ms ?? 0), conflicts: c2 });
        rows.push({ iter, phase: "afterfix", page: 1, ms: Number(f1?.ms ?? 0), conflicts: c1a });
        rows.push({ iter, phase: "afterfix", page: 2, ms: Number(f2?.ms ?? 0), conflicts: c2a });
      }
    }

    // --- Summaries for plotting/reporting ---
    function summarize(phase: "detect" | "afterfix", page: 1 | 2) {
      const xs = rows.filter((r) => r.phase === phase && r.page === page).map((r) => r.ms);
      return {
        median: median(xs),
        p95: [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)],
        n: xs.length,
      };
    }

    const summary = {
      graph: { nodes: g.nodes.length, edges: g.edges.length },
      mismatchesPerIter: expectedConflicts,
      warmup: WARMUP,
      runs: RUNS,
      stats: {
        detect_p1: summarize("detect", 1),
        detect_p2: summarize("detect", 2),
        afterfix_p1: summarize("afterfix", 1),
        afterfix_p2: summarize("afterfix", 2),
      },
      timestamp: new Date().toISOString(),
    };

    // --- Write outputs ---
    const outDir = path.join(process.cwd(), "benchmark-results");
    fs.mkdirSync(outDir, { recursive: true });

    const outJson = path.join(outDir, `feedMediumMismatch.2rep.N${N}.E${g.edges.length}.runs${RUNS}.json`);
    fs.writeFileSync(outJson, JSON.stringify({ summary, rows }, null, 2), "utf-8");

    const outCsv = path.join(outDir, `feedMediumMismatch.2rep.N${N}.E${g.edges.length}.runs${RUNS}.csv`);
    const header = "iter,phase,page,ms,conflicts";
    const csvLines = [header, ...rows.map((r) => `${r.iter},${r.phase},${r.page},${r.ms},${r.conflicts}`)];
    fs.writeFileSync(outCsv, csvLines.join("\n"), "utf-8");

    console.log("Wrote:", outJson);
    console.log("Wrote:", outCsv);
    console.log("Summary:", summary);

    await ctx1.close();
    await ctx2.close();
  });
});
