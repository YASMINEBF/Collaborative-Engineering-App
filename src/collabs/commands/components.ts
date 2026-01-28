// collabs/commands/components.ts
import type { CEngineeringGraph, ComponentId } from "../model/CEngineeringGraph";
import type { ComponentType } from "../model/ComponentTypes";
import { deleteRelationship, createRelationship } from "./relationships";
import { StructuralKind } from "../../models/relationships/enums/RelationshipTypes";
import { ConflictKind } from "../model/enums/ConflictEnum";

/** Keep name handling consistent everywhere. */
function normalizeName(name: string): string {
  return name.trim();
}

/**
 * Validate name uniqueness via the graph.nameIndex.
 * Returns null if OK, otherwise an error message.
 *
 * ignoreId: allow the same component to keep its current name (rename case).
 */
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

/** Create a component (equipment or port) using the CMap factory args. */
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

  // Uses your CMap factory, so this constructs CEquipment/CPort correctly.
  graph.components.set(id, type, normalized);

  // Keep index in sync
  graph.nameIndex.set(normalized, id);

  // Set createdBy on the newly-created component if available
  try {
    const c = graph.components.get(id) as any;
    if (c && typeof c.createdBy !== "undefined") {
      c.createdBy.value = createdBy ?? "";
    }
  } catch (e) {
    // Ignore if map doesn't return a collab object in some setups
  }
}

/** Rename component + maintain nameIndex. */
export function renameComponent(
  graph: CEngineeringGraph,
  id: ComponentId,
  newName: string
) {
  const c = graph.components.get(id);
  if (!c) return;

  const normalized = normalizeName(newName);

  const err = validateUniqueName(graph, normalized, id);
  if (err) throw new Error(err);

  const oldName = c.uniqueName.value;

  // Update value
  c.uniqueName.value = normalized;

  // Maintain index
  if (oldName) graph.nameIndex.delete(oldName);
  graph.nameIndex.set(normalized, id);
}

/** Move node in canvas space. */
export function setComponentPosition(
  graph: CEngineeringGraph,
  id: ComponentId,
  pos: { x: number; y: number }
) {
  const c = graph.components.get(id);
  if (!c) return;
  c.position.value = { x: pos.x, y: pos.y };
}

/** Delete component + clean up indices (and optionally relationships). */
export function deleteComponent(graph: CEngineeringGraph, id: ComponentId, deletedBy: string | null = null) {
  const c = graph.components.get(id);
  if (!c) return;

  const runtime: any = (graph as any).runtime ?? (graph as any).doc ?? null;

  const doWork = () => {
    // 1) Find grandparent (parent of deleted node)
     try {
      // graph.deletionLog was added to CEngineeringGraph in the previous step
      graph.deletionLog.set(String(id), {
        deletedBy: deletedBy ?? "unknown",
        deletedAt: Date.now(),
      });
    } catch (e) {}
    let grandParentId: string | null = null;

// Prefer index if present
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

console.debug("[reparent] grandParentId for deleted", id, "=", grandParentId);

    // 2) Collect:
    //    - outgoing HasPart edges: deleted -> child
    //    - incoming HasPart edges: parent -> deleted  (cleanup!)
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

    // helper: avoid cycles (optional; your version is ok)
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

    // 3) Reparent children
    for (const { relId, childId } of outgoing) {
      // delete old edge deleted->child (also clears parentByChild[child])
      deleteRelationship(graph, relId as any);

      // create new edge grandParent->child if grandParent exists; else child becomes root
      if (grandParentId) {
        if (grandParentId === childId) continue;
        if (hasPath(childId, grandParentId)) continue; // avoid cycles

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
         const created = graph.relationships.get(newRelId);
  console.debug(
    "[reparent] created?",
    !!created,
    "relId=", newRelId,
    "src=", created?.sourceId?.value,
    "tgt=", created?.targetId?.value,
    "kind=", created?.kind?.value
  );

      }
    }

    // 4) IMPORTANT: delete incoming parent->deleted hasPart edge(s)
    for (const relId of incomingToDeleted) {
      deleteRelationship(graph, relId as any);
    }

    // 5) Clean name index
    const name = c.uniqueName.value;
    if (name) graph.nameIndex.delete(name);

    // 6) Delete the component itself
    graph.components.delete(id);
  };

  // Run in one transaction if possible (prevents mid-recompute states)
  if (runtime && typeof runtime.transact === "function") {
    runtime.transact(doWork);
  } else {
    doWork();
  }
}
