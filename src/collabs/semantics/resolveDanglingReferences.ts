import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Simple Dangling Reference Resolution
 * 
 * - If a LIVE edge points to a missing node → create conflict
 * - "Keep Both" → restore node (handled in CollabProvider)
 * - "Delete Both" → delete everything (handled in CollabProvider)
 * - Never resurrect nodes/edges that user explicitly deleted
 */
export default function resolveDanglingReferences(graph: CEngineeringGraph, currentUserId = "system") {
  
  const getDeletionRecord = (id: string): any | null => {
    try {
      return (graph as any).deletionLog?.get?.(String(id)) ?? null;
    } catch {
      return null;
    }
  };

  // Each edge pointing to a missing node gets its own conflictId
  const makeConflictId = (nodeId: string, edgeId: string): string => `dangling::node::${nodeId}::edge::${edgeId}`;

  // Check if user chose "deleteBoth" for this node (any edge)
  const wasNodeExplicitlyDeleted = (nodeId: string): boolean => {
    try {
      for (const [conflictId, c] of graph.conflicts.entries?.() ?? []) {
        if (conflictId.startsWith(`dangling::node::${nodeId}::edge::`) && c?.status?.value === "resolved" && c?.resolution?.value === "deleteBoth") {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  // Resurrect node as tombstone so user can see it in conflict UI
  const ensureTombstone = (id: string): boolean => {
    if (wasNodeExplicitlyDeleted(id)) return false;
    
    const rec = getDeletionRecord(id);
    if (!rec) return false;

    if (!graph.components.get(String(id))) {
      graph.components.set(String(id) as any, rec.type ?? "equipment", rec.uniqueName ?? `(deleted) ${id}`);
      try {
        const c: any = graph.components.get(String(id));
        if (c?.position && rec.position) c.position.value = rec.position;
      } catch {}
    }

    try {
      const c: any = graph.components.get(String(id));
      if (c?.isDeleted) c.isDeleted.value = true;
      if (c?.deletedAt && rec.deletedAt) c.deletedAt.value = rec.deletedAt;
      if (c?.deletedBy && rec.deletedBy) c.deletedBy.value = String(rec.deletedBy);
    } catch {}

    return true;
  };

  // (Removed unused getLiveEdgesForNode)

  const getExistingConflict = (conflictId: string) => {
    try {
      const c = graph.conflicts.get(conflictId);
      if (!c) return null;
      return { status: c.status?.value, resolution: c.resolution?.value };
    } catch {
      return null;
    }
  };

  const createOrReopenConflict = (nodeId: string, edgeId: string, deletedBy?: string) => {
    const conflictId = makeConflictId(nodeId, edgeId);
    const existing = getExistingConflict(conflictId);
    // Already open - don't touch
    if (existing?.status === "open") return;
    // User chose delete - respect it
    if (existing?.status === "resolved" && existing?.resolution === "deleteBoth") return;
    // Create or reopen
    if (!existing) {
      graph.conflicts.set(conflictId, ConflictKind.DanglingReference);
    }
    const c = graph.conflicts.get(conflictId);
    if (!c) return;
    c.entityRefs.add(String(nodeId));
    c.entityRefs.add(edgeId);
    c.winningValue.value = deletedBy ? { intendedDeletionBy: deletedBy } : null;
    c.losingValues.value = [{ missingId: nodeId, tombstoned: true }];
    c.createdBy.value = currentUserId;
    c.createdAt.value = Date.now();
    c.status.value = "open";
  };

  // ========== MAIN LOGIC ==========
  
  // For each edge, if it points to a missing node, create a unique conflict for (node, edge)
  for (const rel of graph.relationships.values()) {
    try {
      const relId = String(rel.id?.value ?? rel.id);
      const srcId = String(rel.sourceId?.value ?? "");
      const tgtId = String(rel.targetId?.value ?? "");
      for (const nodeId of [srcId, tgtId]) {
        if (!nodeId) continue;
        const exists = !!graph.components.get(nodeId);
        const isDeleted = !exists && getDeletionRecord(nodeId);
        if (isDeleted && !wasNodeExplicitlyDeleted(nodeId)) {
          ensureTombstone(nodeId);
          const rec = getDeletionRecord(nodeId);
          createOrReopenConflict(nodeId, relId, rec?.deletedBy);
        }
      }
    } catch {}
  }
}
