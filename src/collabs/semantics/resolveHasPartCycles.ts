import type { CEngineeringGraph } from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";
import { StructuralKind } from "../../models/relationships/enums/RelationshipTypes";

/**
 * Detect directed cycles in the `hasPart` (structural) relationship subgraph
 * and record a persistent `CycleDetected` (`ConflictKind.CycleDetected`) entry
 * referencing all relationships that participate in each cycle.
 *
 * Policy:
 * - If concurrent edits introduce a directed cycle, record a conflict and keep
 *   both/ all edges (no automatic deletion). The conflict records the set of
 *   relationship ids involved so the UI can highlight them and users can decide.
 * - Do not duplicate conflict entries for the same relationship set.
 * - Remove/delete conflicts when the cycle no longer exists.
 */
export function resolveHasPartCycles(graph: CEngineeringGraph, currentUserId = "system") {
  try {
    // Build adjacency list of hasPart edges: src -> [ { tgt, relId } ]
    const adj: Map<string, Array<{ tgt: string; relId: string }>> = new Map();
    const rels: Array<any> = [];

    for (const r of graph.relationships.values()) {
      try {
        if (r.kind?.value !== StructuralKind.HasPart) continue;
        const relId = (r.id?.value ?? r.id) as string;
        const src = String(r.sourceId?.value ?? r.sourceId ?? "");
        const tgt = String(r.targetId?.value ?? r.targetId ?? "");
        if (!src || !tgt) continue;
        rels.push({ id: relId, src, tgt });
        if (!adj.has(src)) adj.set(src, []);
        adj.get(src)!.push({ tgt, relId });
      } catch (e) {}
    }

    // Detect cycles using DFS; collect directed cycles and the relationship ids
    // that participate in each cycle. We maintain parent pointers so when a
    // back-edge is discovered we can walk the stack and collect the exact
    // sequence of edges forming the cycle.
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const parentNode = new Map<string, string | null>();
    const parentEdge = new Map<string, string | null>();
    const cycles: Array<Set<string>> = [];

    function dfs(u: string) {
      visited.add(u);
      inStack.add(u);

      const edges = adj.get(u) ?? [];
      for (const e of edges) {
        const v = e.tgt;
        // If v is on the current recursion stack, we've found a back-edge
        if (inStack.has(v)) {
          // collect edges from u -> v (current edge) plus edges along the
          // parent chain from u back to v
          const cycleSet = new Set<string>();
          cycleSet.add(e.relId);

          // Walk from u back to v using parentNode/parentEdge
          let cur: string | null = u;
          while (cur && cur !== v) {
            const pe = parentEdge.get(cur);
            if (pe) cycleSet.add(pe);
            cur = parentNode.get(cur) ?? null;
          }

          cycles.push(cycleSet);
          continue;
        }

        if (!visited.has(v)) {
          parentNode.set(v, u);
          parentEdge.set(v, e.relId);
          dfs(v);
        }
      }

      inStack.delete(u);
    }

    for (const n of adj.keys()) {
      if (!visited.has(n)) {
        parentNode.set(n, null);
        parentEdge.set(n, null);
        dfs(n);
      }
    }

    // For each detected cycle, create a conflict record unless one already exists
    for (const cycleSet of cycles) {
      try {
        // Find if an existing CycleDetected conflict references any of these rels
        let already = false;
        try {
          for (const existing of graph.conflicts.values()) {
            try {
              if (existing.kind?.value !== ConflictKind.CycleDetected) continue;
              for (const ref of existing.entityRefs?.values ? existing.entityRefs.values() : []) {
                if (cycleSet.has(String(ref))) {
                  already = true;
                  break;
                }
              }
              if (already) break;
            } catch {}
          }
        } catch {}

        if (already) continue;

        const relIds = Array.from(cycleSet).map(String).sort(); // stable ordering
const id = `conf-cycle-${relIds.join("|")}`;            // deterministic id
graph.conflicts.set(id, ConflictKind.CycleDetected);

        const c = graph.conflicts.get(id);
        if (!c) continue;

        // Add all rel ids to entityRefs for highlighting
        for (const relId of cycleSet) c.entityRefs.add(String(relId));

        // Try to annotate winning/losing values with per-edge metadata if present
        const edgesMeta: Array<any> = [];
        for (const relId of cycleSet) {
          const relObj = graph.relationships.get(relId as any);
          const meta: any = { relId };
          try {
            if ((relObj as any)?.createdBy) meta.createdBy = (relObj as any).createdBy?.value;
            if ((relObj as any)?.createdAt) meta.createdAt = (relObj as any).createdAt?.value;
          } catch (e) {}
          edgesMeta.push(meta);
        }

        c.winningValue.value = { rule: "keep-both", edges: edgesMeta };
        c.losingValues.value = edgesMeta;
        c.createdBy.value = currentUserId;
        c.createdAt.value = Date.now();
        c.status.value = "open";
      } catch (e) {}
    }
  } catch (e) {
    // swallow
  }

  // Cleanup pass: remove CycleDetected conflicts that no longer reference existing cycles
  try {
    const pairs: Array<[string, any]> = [];
    try {
      if (typeof graph.conflicts.forEach === "function") {
        graph.conflicts.forEach((v: any, k: any) => pairs.push([String(k), v]));
      } else if (typeof graph.conflicts.entries === "function") {
        for (const [k, v] of graph.conflicts.entries()) pairs.push([String(k), v]);
      }
    } catch (e) {}

    for (const [confId, conf] of pairs) {
      try {
        if (conf.kind?.value !== ConflictKind.CycleDetected) continue;
        const status = conf.status?.value ?? "open";
        if (status !== "open") continue;

        // Check if referenced rels still form a cycle
        const refs: string[] = [];
        for (const ref of conf.entityRefs?.values ? conf.entityRefs.values() : []) refs.push(String(ref));
        if (refs.length === 0) {
          try {
            graph.conflicts.delete(confId);
          } catch (e) {}
          continue;
        }

        // Build small adjacency from those refs and test for cycle
        const subAdj: Map<string, string[]> = new Map();
        for (const rid of refs) {
          const r = graph.relationships.get(rid as any);
          if (!r) continue;
          const s = String(r.sourceId?.value ?? r.sourceId ?? "");
          const t = String(r.targetId?.value ?? r.targetId ?? "");
          if (!subAdj.has(s)) subAdj.set(s, []);
          subAdj.get(s)!.push(t);
        }

        // Quick cycle test on subgraph
        let hasCycle = false;
        const vis = new Set<string>();
        const inS = new Set<string>();

        function d2(n: string) {
          if (inS.has(n)) {
            hasCycle = true;
            return;
          }
          if (vis.has(n) || hasCycle) return;
          vis.add(n);
          inS.add(n);
          const outs = subAdj.get(n) ?? [];
          for (const o of outs) d2(o);
          inS.delete(n);
        }

        for (const n of subAdj.keys()) {
          if (hasCycle) break;
          d2(n);
        }

        if (!hasCycle) {
          try {
            graph.conflicts.delete(confId);
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
}

export default resolveHasPartCycles;
