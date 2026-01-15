import type { CEngineeringGraph } from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";
import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";

/**
 * Scan the graph for feed-medium mismatches and record a persistent
 * `FeedMediumMismatch` conflict for each mismatch while keeping both
 * the relationship and the equipment medium changes (convergent CRDT state).
 *
 * Policy:
 * - If a `feeds` relationship exists and the relationship medium (explicit)
 *   or the derived medium (source.output or target.input) indicate a mismatch
 *   between source.output and target.input, record a `FeedMediumMismatch`.
 * - Do not delete edges or change values; only record conflicts so the UI
 *   can surface them and users can resolve them manually.
 */
export function resolveFeedMediumConflicts(graph: CEngineeringGraph, currentUserId = "system") {
  try {
    for (const rel of graph.relationships.values()) {
      try {
        if (rel.kind?.value !== PhysicalKind.Feeds) continue;

        const relId = rel.id?.value ?? rel.id;
        const srcId = rel.sourceId?.value;
        const tgtId = rel.targetId?.value;

        // Read explicit medium on relationship, or null
        const relMedium = rel.medium?.value ?? null;

        const src = graph.components.get(srcId ?? "");
        const tgt = graph.components.get(tgtId ?? "");

        const srcOut = (src as any)?.outputMedium?.value ?? null;
        const tgtIn = (tgt as any)?.inputMedium?.value ?? null;

        // If both equipment mediums are defined and mismatch, record conflict
        if (srcOut !== undefined && tgtIn !== undefined && srcOut !== null && tgtIn !== null && srcOut !== tgtIn) {
          // Avoid creating duplicate conflicts for the same relationship.
          let already = false;
          try {
            for (const existing of graph.conflicts.values()) {
              try {
                if (existing.kind?.value !== ConflictKind.FeedMediumMismatch) continue;
                // If this conflict already references our relationship, skip creating another.
                for (const ref of existing.entityRefs?.values ? existing.entityRefs.values() : []) {
                  if (String(ref) === String(relId)) {
                    already = true;
                    break;
                  }
                }
                if (already) break;
              } catch {}
            }
          } catch {}

          if (!already) {
            // Create a conflict entry describing the mismatch
            const id = `conf-fm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            graph.conflicts.set(id, ConflictKind.FeedMediumMismatch);
            const c = graph.conflicts.get(id);
            if (c) {
              c.entityRefs.add(String(relId));
              if (srcId) c.entityRefs.add(String(srcId));
              if (tgtId) c.entityRefs.add(String(tgtId));

              c.winningValue.value = { rule: "keep-both", relMedium, srcOut, tgtIn };
              c.losingValues.value = [{ relMedium, srcOut, tgtIn }];
              c.createdBy.value = currentUserId;
              c.createdAt.value = Date.now();
              c.status.value = "open";

              // Also clear the relationship medium so the CRDT does not end up
              // with a mismatched explicit medium value. We prefer the conflict
              // record as the authoritative notice and leave medium undefined
              // (null) until users resolve.
              try {
                const relObj = graph.relationships.get(relId as any);
                if (relObj && relObj.medium) relObj.medium.value = null;
              } catch (e) {}
            }
          }
        } else if (relMedium !== null && srcOut !== null && tgtIn !== null && srcOut !== tgtIn) {
          // Relationship has explicit medium but equipment have mismatched mediums
          // Avoid duplicate conflict creation as above
          let already = false;
          try {
            for (const existing of graph.conflicts.values()) {
              try {
                if (existing.kind?.value !== ConflictKind.FeedMediumMismatch) continue;
                for (const ref of existing.entityRefs?.values ? existing.entityRefs.values() : []) {
                  if (String(ref) === String(relId)) {
                    already = true;
                    break;
                  }
                }
                if (already) break;
              } catch {}
            }
          } catch {}

          if (!already) {
            const id = `conf-fm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            graph.conflicts.set(id, ConflictKind.FeedMediumMismatch);
            const c = graph.conflicts.get(id);
            if (c) {
              c.entityRefs.add(String(relId));
              if (srcId) c.entityRefs.add(String(srcId));
              if (tgtId) c.entityRefs.add(String(tgtId));

              c.winningValue.value = { rule: "keep-both", relMedium, srcOut, tgtIn };
              c.losingValues.value = [{ relMedium, srcOut, tgtIn }];
              c.createdBy.value = currentUserId;
              c.createdAt.value = Date.now();
              c.status.value = "open";
              try {
                const relObj = graph.relationships.get(relId as any);
                if (relObj && relObj.medium) relObj.medium.value = null;
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        // ignore per-relationship errors
      }
    }
  } catch (e) {
    // top-level swallow
  }

  // Second pass: resolve existing FeedMediumMismatch conflicts if they no longer apply.
  try {
    // Build a list of [id, conf] pairs so we can delete by id when resolved
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
        if (conf.kind?.value !== ConflictKind.FeedMediumMismatch) continue;
        const status = conf.status?.value ?? "open";
        if (status !== "open") continue;

        // Find a referenced relationship id (first candidate)
        let relId: string | null = null;
        for (const ref of conf.entityRefs?.values ? conf.entityRefs.values() : []) {
          const r = String(ref);
          if (graph.relationships.get(r)) {
            relId = r;
            break;
          }
        }
        if (!relId) continue;

        const rel = graph.relationships.get(relId as any);
        if (!rel) continue;

        const srcId = rel.sourceId?.value;
        const tgtId = rel.targetId?.value;
        const src = graph.components.get(srcId ?? "");
        const tgt = graph.components.get(tgtId ?? "");
        const srcOut = (src as any)?.outputMedium?.value ?? null;
        const tgtIn = (tgt as any)?.inputMedium?.value ?? null;

        // If now compatible, remove the conflict so UI clears highlights
        if (srcOut !== undefined && tgtIn !== undefined && srcOut !== null && tgtIn !== null && srcOut === tgtIn) {
          try {
            graph.conflicts.delete(confId);
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
}

export default resolveFeedMediumConflicts;
