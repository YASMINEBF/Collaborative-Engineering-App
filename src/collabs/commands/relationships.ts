// src/collabs/commands/relationships.ts
import type { CEngineeringGraph } from "../model/CEngineeringGraph";
import type { RelId } from "../model/CEngineeringGraph";
import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import { Medium } from "../../models/attributes/enums/Medium";
import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";
function makeFeedsKey(portId: string, medium: Medium | null) {
  return `${portId}::${medium ?? "null"}`;
}

/** Delete ONE relationship safely + clean derived indices. */
export function deleteRelationship(graph: CEngineeringGraph, id: RelId) {
  const rel = graph.relationships.get(id);
  if (!rel) return; // idempotent

  // Clean feedsByPortMedium index if needed
  if (rel.kind.value === PhysicalKind.Feeds) {
    const key = makeFeedsKey(rel.sourceId.value, rel.medium.value);
    // Only delete if it still points to this id (avoid nuking someone else's)
    if (graph.feedsByPortMedium.get(key) === id) {
      graph.feedsByPortMedium.delete(key);
    }
  }

  graph.relationships.delete(id);
}

/** Delete all relationships attached to a component id. */
export function deleteRelationshipsForComponent(graph: CEngineeringGraph, componentId: string) {
  const toDelete: string[] = [];

  for (const rel of graph.relationships.values()) {
    if (rel.sourceId.value === componentId || rel.targetId.value === componentId) {
      toDelete.push(rel.id.value);
    }
  }

  for (const id of toDelete) deleteRelationship(graph, id);
}
export function createRelationship(
  graph: CEngineeringGraph,
  id: RelId,
  kind: RelationshipKind,
  sourceId: string,
  targetId: string,
  medium: Medium | null = null,
  sourceHandle: string | null = null,
  targetHandle: string | null = null
) {
  // You used RelationshipSetArgs = [type, kind, sourceId, targetId, medium]
  // Pick a consistent "type" string for the Collabs object (can match kind or be constant).
  const type = "relationship";

  graph.relationships.set(id, type, kind, sourceId, targetId, medium, sourceHandle, targetHandle);
}
