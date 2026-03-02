import type { CEngineeringGraph } from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";
import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";

/**
 * Optimized FeedMediumMismatch resolver
 *
 * Design:
 * - One deterministic conflict per relationship: `conf-fm-${relId}`
 * - No global conflict scans
 * - No deletions (CRDT-safe)
 * - Toggle status between "open" and "resolved"
 * - O(E) complexity
 */
export function resolveFeedMediumConflicts(
  graph: CEngineeringGraph,
  currentUserId = "system"
) {
  try {
    for (const rel of graph.relationships.values()) {
      try {
        // Only feeds relationships
        if (rel.kind?.value !== PhysicalKind.Feeds) continue;

        const relId = String(rel.id?.value ?? rel.id);
        const srcId = rel.sourceId?.value;
        const tgtId = rel.targetId?.value;

        const src = graph.components.get(srcId ?? "");
        const tgt = graph.components.get(tgtId ?? "");

        const srcOut = (src as any)?.outputMedium?.value ?? null;
        const tgtIn = (tgt as any)?.inputMedium?.value ?? null;

        const mismatch =
          srcOut !== undefined &&
          tgtIn !== undefined &&
          srcOut !== null &&
          tgtIn !== null &&
          srcOut !== tgtIn;

        const conflictId = `conf-fm-${relId}`;
        let conflict = graph.conflicts.get(conflictId);

        // ===============================
        // CASE 1: Mismatch detected
        // ===============================
        if (mismatch) {
          // Create conflict if it does not exist
          if (!conflict) {
            graph.conflicts.set(conflictId, ConflictKind.FeedMediumMismatch);
            conflict = graph.conflicts.get(conflictId);
          }

          if (!conflict) continue;

          // Update references (idempotent adds)
          conflict.entityRefs.add(relId);
          if (srcId) conflict.entityRefs.add(String(srcId));
          if (tgtId) conflict.entityRefs.add(String(tgtId));

          // Update payload
          conflict.winningValue.value = {
            rule: "keep-both",
            srcOut,
            tgtIn,
          };

          conflict.losingValues.value = [
            {
              srcOut,
              tgtIn,
            },
          ];

          conflict.createdBy.value = currentUserId;
          conflict.createdAt.value = Date.now();

          // Mark open (important for re-opening resolved conflicts)
          conflict.status.value = "open";

          // Optional: clear explicit relationship medium
          try {
            if (rel.medium) rel.medium.value = null;
          } catch {}

        // ===============================
        // CASE 2: No mismatch → resolve
        // ===============================
        } else {
          if (conflict && conflict.status?.value === "open") {
            conflict.status.value = "resolved";
            conflict.createdBy.value = currentUserId;
            conflict.createdAt.value = Date.now();
          }
        }
      } catch {
        // ignore per-relationship errors
      }
    }
  } catch {
    // swallow top-level errors
  }
}

export default resolveFeedMediumConflicts;
