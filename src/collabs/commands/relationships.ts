// src/collabs/commands/relationships.ts
import type { CEngineeringGraph, RelId } from "../model/CEngineeringGraph";
import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import { PhysicalKind, StructuralKind } from "../../models/relationships/enums/RelationshipTypes";
import { Medium } from "../../models/attributes/enums/Medium";
import { ConflictKind } from "../model/enums/ConflictEnum";

// -------------------------
// helpers
// -------------------------

function makeFeedsKey(portId: string, medium: Medium | null) {
  return `${portId}::${medium ?? "null"}`;
}

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

type DeleteRelationshipOpts = {
  deletedBy?: string;
  recordSnapshot?: boolean; // ✅ default true
};

/** Delete ONE relationship safely + clean derived indices. */
export function deleteRelationship(graph: CEngineeringGraph, id: RelId, opts: DeleteRelationshipOpts = {}) {
  const rel = graph.relationships.get(id);
  if (!rel) return;

  const recordSnapshot = opts.recordSnapshot ?? true;

  // ✅ Snapshot edge BEFORE deleting (so we can restore on concurrent delete-vs-create)
  if (recordSnapshot) {
    try {
      graph.relationshipDeletionLog?.set?.(String(id), {
        deletedAt: Date.now(),
        deletedBy: opts.deletedBy ?? "unknown",
        type: String(rel.type?.value ?? "relationship"),
        kind: rel.kind?.value ?? rel.kind,
        sourceId: String(rel.sourceId.value),
        targetId: String(rel.targetId.value),
        medium: rel.medium?.value ?? null,
        sourceHandle: rel.sourceHandle?.value ?? null,
        targetHandle: rel.targetHandle?.value ?? null,
      });
      try {
        // eslint-disable-next-line no-console
        console.debug("deleteRelationship: recorded relationshipDeletionLog", { id, deletedBy: opts.deletedBy ?? "unknown" });
      } catch {}
    } catch {}
  }

  // Clean feedsByPortMedium index if needed
  if (rel.kind.value === PhysicalKind.Feeds) {
    const key = makeFeedsKey(rel.sourceId.value, rel.medium.value);
    if (graph.feedsByPortMedium.get(key) === id) {
      graph.feedsByPortMedium.delete(key);
    }
  }

  // Clean parentByChild for hasPart if needed
  try {
    if (rel.kind.value === StructuralKind.HasPart) {
      const childId = rel.targetId.value;
      const parentId = rel.sourceId.value;
      if (graph.parentByChild.get(childId) === parentId) {
        graph.parentByChild.delete(childId);
      }
    }
  } catch {}

  graph.relationships.delete(id);
  try {
    // eslint-disable-next-line no-console
    console.debug("deleteRelationship: deleted", { id });
  } catch {}
}

/** Delete all relationships attached to a component id. */
export function deleteRelationshipsForComponent(
  graph: CEngineeringGraph,
  componentId: string,
  deletedBy: string = "unknown"
) {
  const toDelete: string[] = [];

  for (const rel of graph.relationships.values()) {
    if (rel.sourceId.value === componentId || rel.targetId.value === componentId) {
      toDelete.push(rel.id.value);
    }
  }

  for (const id of toDelete) deleteRelationship(graph, id, { deletedBy, recordSnapshot: true });
}

// -------------------------
// creation (with feeds rule)
// -------------------------

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

  let mismatchRecorded = false;

  if (kind === PhysicalKind.Feeds) {
    const source = graph.components.get(sourceId);
    const target = graph.components.get(targetId);
    const s = getEquipmentMediums(source);
    const t = getEquipmentMediums(target);
    if (s.output !== undefined && t.input !== undefined && s.output !== t.input) {
      recordConflict(
        graph,
        ConflictKind.FeedMediumMismatch,
        [id, sourceId, targetId],
        createdBy,
        { required: "source.outputMedium === target.inputMedium" },
        [{ sourceOutput: s.output, targetInput: t.input }]
      );
      mismatchRecorded = true;
    }
  }

  // 2) Create edge
  graph.relationships.set(id, type, kind, sourceId, targetId, medium, sourceHandle, targetHandle);

  // ✅ Set createdBy/createdAt (only if empty / unset)
  try {
    const rel = graph.relationships.get(id) as any;
    if (rel) {
      if (typeof rel.createdAt?.value === "number" && rel.createdAt.value === 0) rel.createdAt.value = Date.now();
      if (typeof rel.createdBy?.value === "string" && !rel.createdBy.value) rel.createdBy.value = createdBy ?? "";
    }
  } catch {}

  // HasPart index sync
  try {
    if (kind === StructuralKind.HasPart) {
      try {
        graph.parentByChild.set(targetId, sourceId);
      } catch {}
    }
  } catch {}

  // clear medium if mismatch
  if (kind === PhysicalKind.Feeds) {
    const rel = graph.relationships.get(id);
    try {
      if (rel && rel.medium && rel.medium.value !== null) {
        const src = graph.components.get(sourceId);
        const tgt = graph.components.get(targetId);
        const s = getEquipmentMediums(src);
        const t = getEquipmentMediums(tgt);
        if (s.output !== undefined && t.input !== undefined && s.output !== t.input) {
          try {
            rel.medium.value = null;
          } catch {}
        }
      }
    } catch {}
  }

  if (kind !== PhysicalKind.Feeds) return;

  if (!mismatchRecorded) {
    const key = makeFeedsKey(sourceId, medium);
    const existing = graph.feedsByPortMedium.get(key);
    if (existing && existing !== id) {
      const winner = existing < id ? existing : id;
      const loser = existing < id ? id : existing;

      graph.feedsByPortMedium.set(key, winner);

      if (loser !== winner) deleteRelationship(graph, loser, { deletedBy: createdBy, recordSnapshot: true });

      recordConflict(
        graph,
        ConflictKind.InvalidFeedCardinality,
        [winner, loser, sourceId],
        createdBy,
        { key, kept: winner },
        [{ removed: loser }]
      );

      if (loser === id) return;
    } else {
      graph.feedsByPortMedium.set(key, id);
    }
  }

  const source = graph.components.get(sourceId);
  const target = graph.components.get(targetId);
  if (!source || !target) return;

  const s = getEquipmentMediums(source);
  const t = getEquipmentMediums(target);

  if (s.output !== undefined && t.input !== undefined && s.output !== t.input && !mismatchRecorded) {
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
