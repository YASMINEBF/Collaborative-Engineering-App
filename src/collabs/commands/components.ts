// collabs/commands/components.ts
import type { CEngineeringGraph, ComponentId } from "../model/CEngineeringGraph";
import type { ComponentType } from "../model/ComponentTypes";
import { deleteRelationshipsForComponent } from "./relationships";

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
export function deleteComponent(graph: CEngineeringGraph, id: ComponentId) {
  const c = graph.components.get(id);
  if (!c) return;

  // 1) delete attached relationships first (referential integrity)
  deleteRelationshipsForComponent(graph, id);

  // 2) clean name index
  const name = c.uniqueName.value;
  if (name) graph.nameIndex.delete(name);

  // 3) delete the component
  graph.components.delete(id);
}
