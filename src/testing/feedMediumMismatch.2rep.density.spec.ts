import { test } from "@playwright/test";
import fs from "fs";
import path from "path";

declare global {
  interface Window {
    __CE_TEST_API__: any;
  }
}

function makeGraph(N = 60, extraEdges = 60) {
  const nodes: any[] = [];
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: `c${i}`,
      type: "equipment",
      name: `node-${i}`,
      position: { x: i * 5, y: 0 },
      attrs: { inputMedium: "Water", outputMedium: "Water" },
    });
  }

  const edges: any[] = [];
  let eid = 0;

  // star edges: c0 -> others
  for (let i = 1; i < N; i++) {-
    edges.push({
      id: `e${eid++}`,
      kind: "feeds",
      source: "c0",
      target: `c${i}`,
      medium: null,
    });
  }

  // extra stable edges
  for (let k = 0; k < extraEdges; k++) {
    const src = (k * 17 + 3) % N;
    let tgt = (k * 31 + 7) % N;
    if (tgt === src) tgt = (tgt + 1) % N;
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

async function settleBoth(p1: any, p2: any) {
  await p1.evaluate(() => window.__CE_TEST_API__.flush?.());
  await p2.evaluate(() => window.__CE_TEST_API__.flush?.());
  await p1.evaluate(() => window.__CE_TEST_API__.flush?.());
}

test.describe("BENCH 2-replica: Conflict Density (N=60 fixed)", () => {
  test.setTimeout(10 * 60_000);

  test("vary mismatches: 1,5,10,20", async ({ browser }) => {
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    await ctx1.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));
    await ctx2.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await Promise.all([page1.goto(appUrl), page2.goto(appUrl)]);
    await Promise.all([
      page1.waitForFunction(() => window.__CE_TEST_API__ !== undefined),
      page2.waitForFunction(() => window.__CE_TEST_API__ !== undefined),
    ]);

    const graph = makeGraph(60, 60);
    await page1.evaluate((g) => window.__CE_TEST_API__.importGraph(g), graph);
    await settleBoth(page1, page2);

    const densities = [1, 5, 10, 20];
    const RUNS = 50;

    const results: any[] = [];

    for (const d of densities) {
      const targets = Array.from({ length: d }, (_, i) => `c${i + 1}`);

      const samples: number[] = [];

      for (let i = 0; i < RUNS; i++) {
        // inject mismatches
        await page1.evaluate((ids) =>
          window.__CE_TEST_API__.bulkEditInput(ids, "Steam"),
          targets
        );
        await settleBoth(page1, page2);

        const t = await page1.evaluate(() =>
          window.__CE_TEST_API__.runFeedMediumResolverTimed("density-detect")
        );

        samples.push(Number(t?.ms ?? 0));

        // fix
        await page1.evaluate((ids) =>
          window.__CE_TEST_API__.bulkEditInput(ids, "Water"),
          targets
        );
        await settleBoth(page1, page2);

        await page1.evaluate(() =>
          window.__CE_TEST_API__.runFeedMediumResolverTimed("density-fix")
        );
      }

      results.push({
        mismatches: d,
        medianDetectMs: median(samples),
      });
    }

    const outDir = path.join(process.cwd(), "benchmark-results");
    fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, "feedMediumMismatch.2rep.density.N60.json");
    fs.writeFileSync(outFile, JSON.stringify({ results }, null, 2), "utf-8");

    console.log("Wrote:", outFile);
    console.log(results);

    await ctx1.close();
    await ctx2.close();
  });
});
