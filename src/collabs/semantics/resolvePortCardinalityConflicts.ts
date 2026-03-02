import type { CEngineeringGraph } from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";
import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";

/**
 * Port Edge Cardinality Resolver
 *
 * Invariant: A port can have at most one outgoing feeds edge per medium.
 *   ∀p ∈ Ports, ∀m ∈ Media : |{ (p, B) ∈ feeds | medium(p, B) = m }| ≤ 1
 *
 * Conflict scenario: Two replicas concurrently create feeds edges from the same
 * output port p to different targets B and C using the same medium m.
 * After synchronisation, both edges exist, violating the cardinality constraint.
 *
 * Resolution policy: Keep both edges and flag for manual resolution.
 * - One deterministic conflict per (portId, medium) pair: `conf-card-${portId}::${medium}`
 * - No auto-deletion (CRDT-safe, preserves both concurrent edits)
 * - O(E) complexity
 */
export function resolvePortCardinalityConflicts(
  graph: CEngineeringGraph,
  currentUserId = "system"
) {
  try {
    // Build a map: portId::medium -> [relId, ...]
    const feedsPerKey = new Map<string, string[]>();

    for (const rel of graph.relationships.values()) {
      try {
        if (rel.kind?.value !== PhysicalKind.Feeds) continue;

        const srcId = String(rel.sourceId?.value ?? "");
        const medium = String(rel.medium?.value ?? "null");
        const relId = String(rel.id?.value ?? "");

        if (!srcId || !relId) continue;

        const key = `${srcId}::${medium}`;
        const existing = feedsPerKey.get(key) ?? [];
        existing.push(relId);
        feedsPerKey.set(key, existing);
      } catch {
        // ignore per-relationship errors
      }
    }

    // Evaluate each (portId, medium) group
    for (const [key, relIds] of feedsPerKey) {
      const conflictId = `conf-card-${key}`;
      let conflict = graph.conflicts.get(conflictId as any);

      if (relIds.length > 1) {
        // ============================================
        // VIOLATION: multiple feeds edges for same key
        // ============================================
        if (!conflict) {
          graph.conflicts.set(conflictId as any, ConflictKind.InvalidFeedCardinality);
          conflict = graph.conflicts.get(conflictId as any);
        }

        if (!conflict) continue;

        // Idempotent: add all involved edge IDs as entity refs
        for (const relId of relIds) {
          conflict.entityRefs.add(relId);
        }

        // Add source port ID (first segment of key before "::")
        const portId = key.split("::")[0];
        if (portId) conflict.entityRefs.add(portId);

        // Record competing edges as the losing values (all are kept, user must choose)
        const currentLosing = conflict.losingValues?.value ?? [];
        const currentLosingStr = JSON.stringify(currentLosing);
        const newLosingStr = JSON.stringify(relIds);

        if (currentLosingStr !== newLosingStr) {
          conflict.losingValues.value = relIds;
          conflict.winningValue.value = {
            rule: "keep-both",
            key,
            portId,
            competingEdges: relIds,
            note: "Manual resolution required: choose which edge to keep",
          };
          conflict.createdBy.value = currentUserId;
          conflict.createdAt.value = Date.now();
        }

        // Re-open if previously resolved but violation reappeared
        if (conflict.status?.value !== "open") {
          conflict.status.value = "open";
          conflict.createdBy.value = currentUserId;
          conflict.createdAt.value = Date.now();
        }
      } else {
        // ============================================
        // NO VIOLATION: resolve any existing conflict
        // ============================================
        if (conflict && conflict.status?.value === "open") {
          conflict.status.value = "resolved";
          conflict.resolution.value = "auto";
          conflict.resolvedBy.value = currentUserId;
          conflict.resolvedAt.value = Date.now();
        }
      }
    }
  } catch {
    // swallow top-level errors
  }
}

export default resolvePortCardinalityConflicts;
