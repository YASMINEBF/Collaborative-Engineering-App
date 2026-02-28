import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __CE_TEST_API__: any;
  }
}

function makeGraph2() {
  return {
    version: 1,
    meta: { generatedAt: Date.now(), N: 2 },
    nodes: [
      {
        id: "c0",
        type: "equipment",
        name: "node-0",
        position: { x: 0, y: 0 },
        attrs: { inputMedium: "Water", outputMedium: "Water" },
      },
      {
        id: "c1",
        type: "equipment",
        name: "node-1",
        position: { x: 50, y: 0 },
        attrs: { inputMedium: "Water", outputMedium: "Water" },
      },
    ],
    edges: [
      { id: "e0", kind: "feeds", source: "c0", target: "c1", medium: null },
    ],
  };
}

async function settleBoth(page1: any, page2: any) {
  await page1.evaluate(() => window.__CE_TEST_API__.flush?.());
  await page2.evaluate(() => window.__CE_TEST_API__.flush?.());
  await page1.evaluate(() => window.__CE_TEST_API__.flush?.());
}

async function getConflictStatusFromSnapshot(page: any, conflictId: string): Promise<string | null> {
  const snap = await page.evaluate(() => window.__CE_TEST_API__.snapshot());
  const confs = snap?.confs ?? [];
  const c = confs.find((x: any) => String(x?.id) === String(conflictId));
  return c?.status ?? null;
}

test.describe("2 replicas: leader-only resolver, conflicts converge", () => {
  test.setTimeout(5 * 60_000);

  test("run resolver only on replica 1 → replica 2 sees open/resolved statuses", async ({ browser }) => {
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    await ctx1.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));
    await ctx2.addInitScript(() => ((globalThis as any).__PLAYWRIGHT__ = true));

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await Promise.all([page1.goto(appUrl), page2.goto(appUrl)]);

    await Promise.all([
      page1.waitForFunction(() => (window as any).__CE_TEST_API__ !== undefined, null, { timeout: 30_000 }),
      page2.waitForFunction(() => (window as any).__CE_TEST_API__ !== undefined, null, { timeout: 30_000 }),
    ]);

    // Import on replica 1 only
    const ok = await page1.evaluate((gg) => window.__CE_TEST_API__.importGraph(gg), makeGraph2());
    expect(ok).toBeTruthy();

    await settleBoth(page1, page2);

    // Clean conflicts
    await page1.evaluate(() => window.__CE_TEST_API__.clearConflicts?.());
    await settleBoth(page1, page2);

    const relId = "e0";
    const conflictId = `conf-fm-${relId}`;

    // Ensure consistent start
    await page1.evaluate(() => window.__CE_TEST_API__.bulkEditInput(["c1"], "Water"));
    await settleBoth(page1, page2);

    // --- Inject mismatch on replica 1 ---
    await page1.evaluate(() => window.__CE_TEST_API__.bulkEditInput(["c1"], "Steam"));
    await settleBoth(page1, page2);

    // --- Run resolver ONLY on replica 1 ---
    await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("leader-detect"));
    await settleBoth(page1, page2);

    // Replica 2 should now show conflict OPEN
    const status2AfterDetect = await getConflictStatusFromSnapshot(page2, conflictId);
    expect(status2AfterDetect).toBe("open");

    // --- Fix mismatch on replica 1 ---
    await page1.evaluate(() => window.__CE_TEST_API__.bulkEditInput(["c1"], "Water"));
    await settleBoth(page1, page2);

    // --- Run resolver ONLY on replica 1 again ---
    await page1.evaluate(() => window.__CE_TEST_API__.runFeedMediumResolverTimed("leader-afterfix"));
    await settleBoth(page1, page2);

    // Replica 2 should now show conflict RESOLVED (design: no deletions)
    const status2AfterFix = await getConflictStatusFromSnapshot(page2, conflictId);
    expect(status2AfterFix).toBe("resolved");

    await ctx1.close();
    await ctx2.close();
  });
});
