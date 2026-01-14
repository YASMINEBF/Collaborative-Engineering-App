// src/collabs/commands/relationships.ts
import type { CEngineeringGraph, RelId } from "../model/CEngineeringGraph";
import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";
import { Medium } from "../../models/attributes/enums/Medium";
import { ConflictKind } from "../model/enums/ConflictEnum";

// -------------------------
// helpers
// -------------------------

function makeFeedsKey(portId: string, medium: Medium | null) {
  return `${portId}::${medium ?? "null"}`;
}

// small util: best-effort check if a component "looks like" equipment in your model
function getEquipmentMediums(component: any): { input?: Medium; output?: Medium } {
  return {
    input: component?.inputMedium?.value,
    output: component?.outputMedium?.value,
  };
}

function recordConflict(
  graph: CEngineeringGraph,
  kind: ConflictKind,
  entityRefs: string[],
  createdBy = "",
  winningValue: unknown = null,
  losingValues: unknown[] = []
) {
  const id = `conflict-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  graph.conflicts.set(id, kind);

  const c = graph.conflicts.get(id);
  if (!c) return;

  for (const ref of entityRefs) c.entityRefs.add(ref);

  c.winningValue.value = winningValue;
  c.losingValues.value = losingValues;
  c.createdBy.value = createdBy;
  c.createdAt.value = Date.now();
  c.status.value = "open";
}

// -------------------------
// deletion (safe + cascades)
// -------------------------

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

// -------------------------
// creation (with feeds rule)
// -------------------------

/**
 * Create relationship.
 * - Always creates the edge (CRDT convergence)
 * - If feeds + medium mismatch, logs a conflict in graph.conflicts
 * - Updates feedsByPortMedium index for feeds (deterministic keep-one behavior)
 */
export function createRelationship(
  graph: CEngineeringGraph,
  id: RelId,
  kind: RelationshipKind,
  sourceId: string,
  targetId: string,
  medium: Medium | null = null,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
  createdBy = ""
) {
  const type = "relationship";

  // 1) If this is a Feeds relationship, validate medium compatibility first.
  //    If both source and target equipment have defined mediums and they mismatch,
  //    record a FeedMediumMismatch conflict and DO NOT create the relationship.
  if (kind === PhysicalKind.Feeds) {
    const source = graph.components.get(sourceId);
    const target = graph.components.get(targetId);
    const s = getEquipmentMediums(source);
    const t = getEquipmentMediums(target);

    if (s.output !== undefined && t.input !== undefined && s.output !== t.input) {
      // Log conflict and skip creation
      recordConflict(
        graph,
        ConflictKind.FeedMediumMismatch,
        [id, sourceId, targetId],
        createdBy,
        { required: "source.outputMedium === target.inputMedium" },
        [{ sourceOutput: s.output, targetInput: t.input }]
      );
      return;
    }
  }

  // 2) Create it (CRDT record)
  graph.relationships.set(id, type, kind, sourceId, targetId, medium, sourceHandle, targetHandle);

  // 3) If not feeds → done
  if (kind !== PhysicalKind.Feeds) return;

  // 3) Derived index + cardinality: keep-one deterministically for (source, medium)
  //    If there’s already one, we keep the lexicographically smaller id.
  const key = makeFeedsKey(sourceId, medium);
  const existing = graph.feedsByPortMedium.get(key);
  if (existing && existing !== id) {
    const winner = existing < id ? existing : id;
    const loser = existing < id ? id : existing;

    graph.feedsByPortMedium.set(key, winner);

    // delete the loser edge to enforce 1-per-key
    // (also prevents UI from showing both)
    if (loser !== winner) deleteRelationship(graph, loser);

    // record a conflict so users know what happened
    recordConflict(
      graph,
      ConflictKind.InvalidFeedCardinality,
      [winner, loser, sourceId],
      createdBy,
      { key, kept: winner },
      [{ removed: loser }]
    );

    // if we deleted the current edge, stop here
    if (loser === id) return;
  } else {
    graph.feedsByPortMedium.set(key, id);
  }

  // 4) Enforce “feeds medium compatibility” (equipment output == equipment input)
  //    NOTE: your components may be ports or equipment; we check the equipment fields if present.
  const source = graph.components.get(sourceId);
  const target = graph.components.get(targetId);
  if (!source || !target) {
    // dangling references invariant handled elsewhere; optionally log conflict here too
    return;
  }

  const s = getEquipmentMediums(source);
  const t = getEquipmentMediums(target);

  // Only validate when both sides have the mediums (i.e., they are equipment nodes).
  // If you later decide feeds must be port->port, swap this logic accordingly.
  if (s.output !== undefined && t.input !== undefined && s.output !== t.input) {
    recordConflict(
      graph,
      ConflictKind.FeedMediumMismatch,
      [id, sourceId, targetId],
      createdBy,
      { required: "source.outputMedium === target.inputMedium" },
      [{ sourceOutput: s.output, targetInput: t.input }]
    );
  }
}

