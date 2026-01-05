// src/collabs/commands/relationships.ts
import type { CEngineeringGraph } from "../model/CEngineeringGraph";
import type { RelId } from "../model/CEngineeringGraph";
import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import { Medium } from "../../models/attributes/enums/Medium";

export function createRelationship(
  graph: CEngineeringGraph,
  id: RelId,
  kind: RelationshipKind,
  sourceId: string,
  targetId: string,
  medium: Medium | null = null
) {
  // You used RelationshipSetArgs = [type, kind, sourceId, targetId, medium]
  // Pick a consistent "type" string for the Collabs object (can match kind or be constant).
  const type = "relationship";

  graph.relationships.set(id, type, kind, sourceId, targetId, medium);
}
