// collabs/commands/components.ts
import type { CEngineeringGraph, ComponentId } from "../model/CEngineeringGraph";
import type { ComponentType } from "../model/ComponentTypes";
import { deleteRelationship, createRelationship } from "./relationships";
import { StructuralKind } from "../../models/relationships/enums/RelationshipTypes";

/** Keep name handling consistent everywhere. */
function normalizeName(name: string): string {
  return name.trim();
}

export function validateUniqueName(
  graph: CEngineeringGraph,
  name: string,
  ignoreId?: ComponentId
): string | null {
  const normalized = normalizeName(name);
  if (!normalized) return "Name cannot be empty.";

  const existingId = graph.nameIndex.get(normalized);
  if (!existingId) return null;

  if (ignoreId && existingId === ignoreId) return null;

  return `The name "${normalized}" is already used. Please choose another name.`;
}

export function createComponent(
  graph: CEngineeringGraph,
  id: ComponentId,
  type: ComponentType,
  uniqueName: string,
  createdBy?: string
) {
  const normalized = normalizeName(uniqueName);

  const err = validateUniqueName(graph, normalized);
  if (err) throw new Error(err);

  graph.components.set(id, type, normalized);
  graph.nameIndex.set(normalized, id);

  try {
    const c = graph.components.get(id) as any;
    if (c && typeof c.createdBy !== "undefined") c.createdBy.value = createdBy ?? "";
  } catch {}
}

export function renameComponent(graph: CEngineeringGraph, id: ComponentId, newName: string) {
  const c = graph.components.get(id);
  if (!c) return;

  const normalized = normalizeName(newName);

  const err = validateUniqueName(graph, normalized, id);
  if (err) throw new Error(err);

  const oldName = c.uniqueName.value;
  c.uniqueName.value = normalized;

  if (oldName) graph.nameIndex.delete(oldName);
  graph.nameIndex.set(normalized, id);
}

export function setComponentPosition(
  graph: CEngineeringGraph,
  id: ComponentId,
  pos: { x: number; y: number }
) {
  const c = graph.components.get(id);
  if (!c) return;
  c.position.value = { x: pos.x, y: pos.y };
}

/**
 * Hard delete semantics (normal behavior):
 * - Deletes ALL incident relationships (any kind), so deleted nodes don't "reappear"
 *   due to dangling resolvers.
 * - Still records deletionLog snapshot so that *true concurrency* (remote edge-create)
 *   can resurrect as a tombstone later.
 */
export function deleteComponent(
  graph: CEngineeringGraph,
  id: ComponentId,
  deletedBy: string | null = null
) {
  const c: any = graph.components.get(id);
  if (!c) return;

  const runtime: any = (graph as any).runtime ?? (graph as any).doc ?? null;

  const doWork = () => {
    const deletedAt = Date.now();

    // 0) record deletion attribution + snapshot for concurrency-resurrection
    try {
      const type = (c.type?.value ?? c.type ?? "equipment") as ComponentType;
      const uniqueName = String(c.uniqueName?.value ?? id);
      const position = (c.position?.value ?? null) as { x: number; y: number } | null;

      graph.deletionLog.set(String(id), {
        deletedBy: deletedBy ?? "unknown",
        deletedAt,
        type,
        uniqueName,
        position,
      });
    } catch {}

    // 1) Find grandparent (parent of deleted node) for HasPart reparenting
    let grandParentId: string | null = null;

    try {
      grandParentId = graph.parentByChild.get(id) ?? null;
    } catch {
      grandParentId = null;
    }

    // Fallback: derive from incoming hasPart edge parent -> deleted
    if (!grandParentId) {
      for (const r of graph.relationships.values()) {
        if (r.kind.value !== StructuralKind.HasPart) continue;
        if (r.targetId.value === id) {
          grandParentId = r.sourceId.value;
          break;
        }
      }
    }

    // 2) Collect HasPart outgoing + incoming for reparenting
    const outgoing: Array<{ relId: string; childId: string }> = [];
    const incomingToDeleted: string[] = [];

    for (const r of graph.relationships.values()) {
      if (r.kind.value !== StructuralKind.HasPart) continue;

      const src = r.sourceId.value;
      const tgt = r.targetId.value;
      const relId = r.id.value;

      if (src === id) outgoing.push({ relId, childId: tgt });
      if (tgt === id) incomingToDeleted.push(relId);
    }

    const hasPath = (fromId: string, toId: string) => {
      const visited = new Set<string>();
      const stack = [fromId];
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === toId) return true;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const rr of graph.relationships.values()) {
          if (rr.kind.value !== StructuralKind.HasPart) continue;
          if (rr.sourceId.value === cur) stack.push(rr.targetId.value);
        }
      }
      return false;
    };

    // 3) Reparent children (HasPart only)
    for (const { relId, childId } of outgoing) {
      deleteRelationship(graph, relId as any);

      if (grandParentId) {
        if (grandParentId === childId) continue;
        if (hasPath(childId, grandParentId)) continue;

        const newRelId = `reparent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        createRelationship(
          graph as any,
          newRelId,
          StructuralKind.HasPart as any,
          grandParentId,
          childId,
          null,
          null,
          null,
          deletedBy ?? ""
        );
      }
    }

    // 4) delete incoming parent->deleted hasPart edge(s)
    for (const relId of incomingToDeleted) deleteRelationship(graph, relId as any);

    // 5) IMPORTANT: delete ALL remaining incident relationships (any kind)
    // This prevents immediate resurrection in non-concurrent cases.
    const incidentRelIds: string[] = [];
    for (const r of graph.relationships.values()) {
      const src = r.sourceId.value;
      const tgt = r.targetId.value;
      if (src === id || tgt === id) incidentRelIds.push(String(r.id.value));
    }
    for (const rid of incidentRelIds) deleteRelationship(graph, rid as any);

    // 6) Clean name index
    try {
      const name = c.uniqueName?.value;
      if (name) graph.nameIndex.delete(String(name));
    } catch {}

    // 7) Remove indices pointing to this id
    try { graph.parentByChild.delete(id); } catch {}

    // 8) HARD delete component
    graph.components.delete(id);
  };

  if (runtime && typeof runtime.transact === "function") runtime.transact(doWork);
  else doWork();
}
