// src/testing/exposeTestApi.ts
type Setup = {
  graph: any;
  doc: any;
  userId?: string;
};

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function exposeTestApi({ graph, doc, userId }: Setup) {
  const w = window as any;

  // ✅ Always overwrite the stub if it exists
  // If we already exposed the real API, do nothing.
  if (w.__CE_TEST_API__?.__isReal === true) return;

  // Simple metrics bucket
  const metrics = {
    marks: new Map<string, number>(),
    measures: [] as Array<{ name: string; ms: number; meta?: any }>,
    counters: new Map<string, number>(),
  };

  const api = {
    __isReal: true,

    // --- identity ---
    getUserId: () => userId ?? "unknown",

    // --- doc helpers ---
    flush: async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      return true;
    },

    // --- metrics ---
    mark: (name: string) => {
      metrics.marks.set(name, now());
      return true;
    },
    measure: (name: string, startMark: string, meta?: any) => {
      const s = metrics.marks.get(startMark);
      if (s == null) return false;
      const ms = now() - s;
      metrics.measures.push({ name, ms, meta });
      return true;
    },
    inc: (key: string, by = 1) => {
      metrics.counters.set(key, (metrics.counters.get(key) ?? 0) + by);
      return true;
    },
    getMetrics: () => ({
      measures: metrics.measures.slice(),
      counters: Array.from(metrics.counters.entries()),
    }),
    resetMetrics: () => {
      metrics.marks.clear();
      metrics.measures = [];
      metrics.counters.clear();
      return true;
    },

    // --- graph snapshots ---
    snapshot: () => {
      const comps: string[] = [];
      const rels: string[] = [];
      const confs: Array<{ id: string; kind: any; status: any; refs: string[]; key?: string }> = [];

      try {
        for (const c of graph.components?.values?.() ?? []) comps.push(String(c.id?.value ?? c.id));
      } catch {}
      try {
        for (const r of graph.relationships?.values?.() ?? []) rels.push(String(r.id?.value ?? r.id));
      } catch {}
      try {
        if (graph.conflicts?.entries) {
          for (const [id, c] of graph.conflicts.entries()) {
            const refs = c.entityRefs?.values ? Array.from(c.entityRefs.values()).map(String) : [];
            let key: string | undefined;
            try {
              key = c.winningValue?.value?.key;
            } catch {}
            confs.push({
              id: String(id),
              kind: c.kind?.value,
              status: c.status?.value,
              refs,
              key,
            });
          }
        }
      } catch {}

      return { comps, rels, confs };
    },

    getOpenConflictsByKind: (kind: any) => {
      const out: any[] = [];
      try {
        for (const [id, c] of graph.conflicts.entries()) {
          if (c.kind?.value !== kind) continue;
          if ((c.status?.value ?? "open") !== "open") continue;
          out.push({
            id: String(id),
            refs: c.entityRefs?.values ? Array.from(c.entityRefs.values()).map(String) : [],
            winning: c.winningValue?.value ?? null,
            losing: c.losingValues?.value ?? null,
          });
        }
      } catch {}
      return out;
    },
  };

  w.__CE_TEST_API__ = api;
}
