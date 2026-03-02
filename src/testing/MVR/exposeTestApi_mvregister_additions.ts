/**
 * Drop-in additions for src/testing/exposeTestApi.ts to support MV-register benchmarks.
 *
 * Paste the methods in the `api` object created inside exposeTestApi().
 * They do NOT change existing FeedMediumMismatch helpers.
 */

import { applyMVRegisterResolution } from "../../collabs/semantics/resolveMVRegisterConflicts";
import resolveValueUnitConflicts from "../../collabs/semantics/resolveValueUnitConflicts"; // replace with MV detector
import { ConflictKind } from "../../collabs/model/enums/ConflictEnum";

export function addMVHelpers(api: any, graph: any) {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  api.runMVResolverTimed = (asUser?: string) => {
    const t0 = now();
    try {
      // Replace with your MV detector/resolver entrypoint
      resolveValueUnitConflicts(graph as any, asUser ?? "e2e");
    } catch {}
    const t1 = now();
    return { ms: t1 - t0 };
  };

  api.getMVConflictCount = () => {
    let c = 0;
    try {
      for (const [, conf] of graph.conflicts.entries()) {
        const status = conf.status?.value ?? "open";
        if (status !== "open") continue;
        const kind = conf.kind?.value ?? conf.kind;
        if (kind === ConflictKind.ConcurrentAttributeEdit || kind === ConflictKind.SemanticallyRelatedAttributes) c++;
      }
    } catch {}
    return c;
  };

  // Inject "true concurrency" in the browser is tricky because you only have one replica in one page.
  // In the two-replica Playwright benchmark, use this ONLY on one page to write values,
  // and on the other page write the conflicting values before flushing.
  api.bulkInjectMVConflicts = (targets: Array<{ compId: string; key: string }>, vA: any, vB: any) => {
    try {
      // This page writes vA; the other replica should write vB for the same keys before flush.
      for (const t of targets) {
        const c = graph.components.get(String(t.compId));
        if (!c || !c.attrs || typeof c.attrs.set !== "function") continue;
        c.attrs.set(String(t.key), vA);
      }
      // store vB request so the other page can apply it if you want a symmetric API
      (window as any).__MV_INJECT_VB__ = { targets, vB };
      return true;
    } catch {
      return false;
    }
  };

  api.applyPendingVB = () => {
    try {
      const pending = (window as any).__MV_INJECT_VB__;
      if (!pending) return false;
      for (const t of pending.targets) {
        const c = graph.components.get(String(t.compId));
        if (!c || !c.attrs || typeof c.attrs.set !== "function") continue;
        c.attrs.set(String(t.key), pending.vB);
      }
      (window as any).__MV_INJECT_VB__ = null;
      return true;
    } catch {
      return false;
    }
  };

  api.bulkResolveMVConflicts = (targets: Array<{ compId: string; key: string }>, pick: "A" | "B") => {
    try {
      for (const t of targets) {
        const c = graph.components.get(String(t.compId));
        if (!c || !c.attrs || typeof c.attrs.getConflicts !== "function") continue;
        const candidates = c.attrs.getConflicts(String(t.key)) ?? [];
        if (candidates.length < 1) continue;
        const chosen = pick === "A" ? candidates[0] : candidates[Math.min(1, candidates.length - 1)];
        applyMVRegisterResolution(graph as any, String(t.compId), chosen, "e2e");
      }
      return true;
    } catch {
      return false;
    }
  };

  return api;
}
