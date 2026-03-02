import { test } from "@playwright/test";
import fs from "fs";
import path from "path";

declare global {
  interface Window {
    __CE_TEST_API__: any;
  }
}

function makeGraph(N = 60) {
  const nodes: any[] = [];
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: `c${i}`,
      type: "equipment",
      name: `node-${i}`,
      position: { x: i * 5, y: 0 },
      attrs: {},
    });
  }
  return {
    version: 1,
    meta: { generatedAt: Date.now(), N },
    nodes,
    edges: [],
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

async function waitForCandidates(
  page: any,
  compId: string,
  key: string,
  minCount: number,
  timeoutMs = 3000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = await page.evaluate(
      ({ compId, key }: any) => window.__CE_TEST_API__.getAttrConflictsMV(compId, key),
      { compId, key }
    );
    if (candidates.length >= minCount) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Timeout: candidates never reached ${minCount} for ${compId}/${key}`);
}

test.describe("BENCH 2-replica: MVRegister Conflict Density (N=60 fixed)", () => {
  test.setTimeout(10 * 60_000);

  test("vary concurrent conflicts: 1,5,10,20", async ({ browser }) => {
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

    const N = 60;
    const graph = makeGraph(N);
    await page1.evaluate((g) => window.__CE_TEST_API__.importGraph(g), graph);
    await settleBoth(page1, page2);

    const densities = [1, 5, 10, 20];
    const RUNS = 50;
    const BASE_KEY = "attr:density";

    const results: any[] = [];

    for (const D of densities) {
      const keys = Array.from({ length: D }, (_, i) => `${BASE_KEY}${i}`);
      const compId = "c0";

      const detectSamples: number[] = [];

      for (let i = 0; i < RUNS; i++) {
        // Pause resolver so it doesn't collapse concurrent writes
        await page1.evaluate(() => { (window as any).__CE_RESOLVER_PAUSED__ = true; });
        await page2.evaluate(() => { (window as any).__CE_RESOLVER_PAUSED__ = true; });

        // Disconnect both replicas
        await page1.evaluate(() => window.__CE_TEST_API__.disconnect());
        await page2.evaluate(() => window.__CE_TEST_API__.disconnect());

        // Each replica writes D keys on c0 while disconnected
        for (const key of keys) {
          await page1.evaluate(
            ({ compId, key, i }: any) => window.__CE_TEST_API__.setAttrMV(compId, key, { value: "A", run: i }),
            { compId, key, i }
          );
          await page2.evaluate(
            ({ compId, key, i }: any) => window.__CE_TEST_API__.setAttrMV(compId, key, { value: "B", run: i }),
            { compId, key, i }
          );
        }

        // Reconnect and wait for sync
        await page1.evaluate(() => window.__CE_TEST_API__.reconnect());
        await page2.evaluate(() => window.__CE_TEST_API__.reconnect());
        await new Promise(r => setTimeout(r, 200));

        // Wait until first key has 2 candidates on both replicas
        await waitForCandidates(page1, compId, keys[0], 2);
        await waitForCandidates(page2, compId, keys[0], 2);

        // Measure detection: single page.evaluate scanning all N components
        // for all D keys — simulating the real resolver scan
        const detectMs = await page1.evaluate(
          ({ keys, N }: any) => {
            const t0 = performance.now();
            for (let i = 0; i < N; i++) {
              for (const key of keys) {
                window.__CE_TEST_API__.getAttrConflictsMV(`c${i}`, key);
              }
            }
            return performance.now() - t0;
          },
          { keys, N }
        );
        detectSamples.push(detectMs);

        // Resolve all D conflicts on page1
        for (const key of keys) {
          const candidates = await page1.evaluate(
            ({ compId, key }: any) => window.__CE_TEST_API__.getAttrConflictsMV(compId, key),
            { compId, key }
          );
          if (candidates.length > 0) {
            await page1.evaluate(
              ({ compId, chosen }: any) => window.__CE_TEST_API__.applyMVResolution(compId, chosen),
              { compId, chosen: candidates[i % candidates.length] }
            );
          }
        }

        // Resume resolver and settle
        await page1.evaluate(() => { (window as any).__CE_RESOLVER_PAUSED__ = false; });
        await page2.evaluate(() => { (window as any).__CE_RESOLVER_PAUSED__ = false; });
        await settleBoth(page1, page2);
      }

      results.push({
        conflicts: D,
        medianDetectMs: median(detectSamples),
      });

      console.log(`done D=${D} medianDetect=${median(detectSamples).toFixed(3)}ms`);
    }

    const outDir = path.join(process.cwd(), "benchmark-results");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "mvregister.2rep.density.N60.json");
    fs.writeFileSync(outFile, JSON.stringify({ results }, null, 2), "utf-8");

    console.log("Wrote:", outFile);
    console.log(results);

    await ctx1.close();
    await ctx2.close();
  });
});