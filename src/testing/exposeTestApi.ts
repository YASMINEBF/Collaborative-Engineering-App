// src/testing/exposeTestApi.ts
import resolveFeedMediumConflicts from "../collabs/semantics/resolveFeedMediumConflicts";
import { ConflictKind } from "../collabs/model/enums/ConflictEnum";

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
  if (w.__CE_TEST_API__?.__isReal === true) return;

  const api = {
    __isReal: true,

    getUserId: () => userId ?? "unknown",

    flush: async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      return true;
    },

    snapshot: () => {
      const comps: string[] = [];
      const rels: string[] = [];
      const confs: Array<{ id: string; kind: any; status: any; refs: string[] }> = [];

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
            confs.push({
              id: String(id),
              kind: c.kind?.value ?? c.kind,
              status: c.status?.value,
              refs,
            });
          }
        }
      } catch {}

      return { comps, rels, confs };
    },

    clearConflicts: () => {
      try {
        const ids: any[] = [];
        try {
          if (graph.conflicts?.keys) {
            for (const k of graph.conflicts.keys()) ids.push(k);
          } else if (graph.conflicts?.entries) {
            for (const [k] of graph.conflicts.entries()) ids.push(k);
          }
        } catch {}
        for (const k of ids) {
          try {
            graph.conflicts.delete(k);
          } catch {}
        }
        return true;
      } catch {
        return false;
      }
    },

    // -------- Resolver timing --------
    runFeedMediumResolverTimed: (asUser?: string) => {
      const t0 = now();
      try {
        resolveFeedMediumConflicts(graph as any, asUser ?? "e2e");
      } catch {}
      const t1 = now();
      return { ms: t1 - t0 };
    },

    // Count ALL feed-medium mismatches (global)
    getFeedMediumMismatchCount: () => {
      let c = 0;
      try {
        for (const [, conf] of graph.conflicts.entries()) {
          try {
            const kind = conf.kind?.value ?? conf.kind;
            const status = conf.status?.value ?? "open";
            if (status !== "open") continue;
            if (kind === ConflictKind.FeedMediumMismatch) c++;
          } catch {}
        }
      } catch {}
      return c;
    },

    //  Count feed-medium mismatch conflicts that reference a SPECIFIC relationship id
    getFeedMediumMismatchCountForRel: (relId: string) => {
      let c = 0;
      const relKey = String(relId);
      try {
        for (const [, conf] of graph.conflicts.entries()) {
          try {
            const kind = conf.kind?.value ?? conf.kind;
            const status = conf.status?.value ?? "open";
            if (status !== "open") continue;
            if (kind !== ConflictKind.FeedMediumMismatch) continue;

            const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()).map(String) : [];
            if (refs.includes(relKey)) c++;
          } catch {}
        }
      } catch {}
      return c;
    },

    //  Remove any feed-medium mismatch conflicts that reference a SPECIFIC relationship id
    clearFeedMediumMismatchForRel: (relId: string) => {
      const relKey = String(relId);
      try {
        const toDelete: string[] = [];
        for (const [id, conf] of graph.conflicts.entries()) {
          try {
            const kind = conf.kind?.value ?? conf.kind;
            if (kind !== ConflictKind.FeedMediumMismatch) continue;

            const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()).map(String) : [];
            if (refs.includes(relKey)) toDelete.push(String(id));
          } catch {}
        }
        for (const id of toDelete) {
          try {
            graph.conflicts.delete(id);
          } catch {}
        }
        return true;
      } catch {
        return false;
      }
    },

    // -------- Import / bulk helpers --------
    importGraph: (fileObj: any) => {
      try {
        try {
          const relIds = Array.from(graph.relationships.keys());
          for (const id of relIds) graph.relationships.delete(id);
        } catch {}
        try {
          const compIds = Array.from(graph.components.keys());
          for (const id of compIds) graph.components.delete(id);
        } catch {}
        // wipe conflicts too (avoids stale conflicts across runs)
        try {
          const confIds = Array.from(graph.conflicts.keys());
          for (const id of confIds) graph.conflicts.delete(id);
        } catch {}

        const nodes = fileObj.nodes ?? [];
        for (const n of nodes) {
          try {
            const id = String(n.id);
            const type = n.type === "port" ? "port" : "equipment";
            const name = String(n.name ?? id);
            graph.components.set(id, type, name);

            const comp: any = graph.components.get(id);
            const attrs = n.attrs ?? {};

            if (type === "equipment") {
              try {
                if (typeof attrs.inputMedium === "string") (comp as any).inputMedium.value = attrs.inputMedium;
              } catch {}
              try {
                if (typeof attrs.outputMedium === "string") (comp as any).outputMedium.value = attrs.outputMedium;
              } catch {}
            }

            if (n.position) {
              try {
                (comp as any).position.value = n.position;
              } catch {}
            }
          } catch {}
        }

        const edges = fileObj.edges ?? [];
        for (const e of edges) {
          try {
            const id = String(e.id);
            const kind = e.kind as any;
            const source = String(e.source);
            const target = String(e.target);
            const medium = e.medium ?? null;
            graph.relationships.set(
              id,
              "physical",
              kind,
              source,
              target,
              medium,
              e.sourceHandle ?? null,
              e.targetHandle ?? null
            );
          } catch {}
        }

        return true;
      } catch {
        return false;
      }
    },

    getRelationships: () => {
      const out: any[] = [];
      try {
        for (const r of graph.relationships.values()) {
          try {
            out.push({
              id: String(r.id?.value ?? r.id),
              source: String(r.sourceId?.value),
              target: String(r.targetId?.value),
            });
          } catch {}
        }
      } catch {}
      return out;
    },

    getComponentMediaInfo: (ids?: string[]) => {
      const out: Record<string, { hasInput: boolean; hasOutput: boolean }> = {};
      try {
        const keys = ids && ids.length ? ids : Array.from(graph.components.keys());
        for (const id of keys) {
          try {
            const comp = graph.components.get(id);
            out[String(id)] = {
              hasInput: !!(comp && (comp as any).inputMedium),
              hasOutput: !!(comp && (comp as any).outputMedium),
            };
          } catch {}
        }
      } catch {}
      return out;
    },

    bulkEditOutput: (ids: string[], medium: string) => {
      try {
        for (const id of ids) {
          try {
            const comp = graph.components.get(id);
            if (comp && (comp as any).outputMedium) (comp as any).outputMedium.value = medium;
          } catch {}
        }
        return true;
      } catch {
        return false;
      }
    },

    bulkEditInput: (ids: string[], medium: string) => {
      try {
        for (const id of ids) {
          try {
            const comp = graph.components.get(id);
            if (comp && (comp as any).inputMedium) (comp as any).inputMedium.value = medium;
          } catch {}
        }
        return true;
      } catch {
        return false;
      }
    },
  };

  w.__CE_TEST_API__ = api;
}
