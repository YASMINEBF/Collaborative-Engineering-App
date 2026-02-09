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
  // eslint-disable-next-line no-console
  console.log(`%c[deleteComponent] START - deleting node: ${id}`, 'color: red; font-weight: bold');
  
  const c: any = graph.components.get(id);
  if (!c) {
    // eslint-disable-next-line no-console
    console.log(`[deleteComponent] Component ${id} not found, aborting`);
    return;
  }

  const runtime: any = (graph as any).runtime ?? (graph as any).doc ?? null;

  const doWork = () => {
    const deletedAt = Date.now();
    // eslint-disable-next-line no-console
    console.log(`[deleteComponent] deletedAt: ${deletedAt}, deletedBy: ${deletedBy ?? "unknown"}`);

    // 0) record deletion attribution + snapshot for concurrency-resurrection
    try {
      const type = (c.type?.value ?? c.type ?? "equipment") as ComponentType;
      const uniqueName = String(c.uniqueName?.value ?? id);
      const position = (c.position?.value ?? null) as { x: number; y: number } | null;

      // Capture a snapshot of incident relationships so we can restore them
      // if a concurrent create references this node.
      const relSnapshots: Array<{
        id: string;
        type: string;
        kind: any;
        sourceId: string;
        targetId: string;
        medium: any;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      }> = [];
      
      // eslint-disable-next-line no-console
      console.log(`[deleteComponent] Scanning relationships for node ${id}...`);
      
      // Helper to extract primitive value from potential CRDT wrapper
      const toPrimitive = (val: any): any => {
        if (val === null || val === undefined) return null;
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return val;
        if (typeof val === "object" && "value" in val) {
          const inner = val.value;
          if (inner === null || inner === undefined) return null;
          if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") return inner;
          return String(inner);
        }
        // If it's still an object, stringify it to avoid circular refs
        try { return String(val); } catch { return null; }
      };
      
      try {
        for (const r of graph.relationships.values()) {
          try {
            const rid = String(r.id?.value ?? r.id ?? "");
            const rs = String(r.sourceId?.value ?? r.sourceId ?? "");
            const rt = String(r.targetId?.value ?? r.targetId ?? "");
            if (rs === id || rt === id) {
              // eslint-disable-next-line no-console
              console.log(`[deleteComponent] Found incident relationship: ${rid} (${rs} -> ${rt})`);
              const sh = toPrimitive(r.sourceHandle);
              const th = toPrimitive(r.targetHandle);
              const kindVal = toPrimitive(r.kind);
              const mediumVal = toPrimitive(r.medium);
              const typeVal = toPrimitive(r.type) ?? "relationship";
              
              relSnapshots.push({
                id: rid,
                type: String(typeVal),
                kind: kindVal,
                sourceId: rs,
                targetId: rt,
                medium: mediumVal,
                sourceHandle: sh,
                targetHandle: th,
              });
            }
          } catch {}
        }
      } catch {}

      // eslint-disable-next-line no-console
      console.log(`%c[deleteComponent] Captured ${relSnapshots.length} relationship snapshots`, 'color: blue; font-weight: bold');
      // eslint-disable-next-line no-console
      console.log(`[deleteComponent] Relationship IDs:`, relSnapshots.map(r => r.id));

      // CValueMap can't serialize nested arrays/objects directly, so we JSON-stringify the relationships
      const deletionRecord = {
        deletedBy: deletedBy ?? "unknown",
        deletedAt,
        type,
        uniqueName,
        position,
        // Store as JSON string since CValueMap doesn't support nested object serialization
        relationshipsJson: JSON.stringify(relSnapshots),
      };
      
      // eslint-disable-next-line no-console
      console.log(`%c[deleteComponent] Writing to deletionLog for ${id}:`, 'color: green; font-weight: bold', deletionRecord);
      
      graph.deletionLog.set(String(id), deletionRecord as any);
      
      // Verify it was written
      const written = graph.deletionLog.get(String(id));
      // eslint-disable-next-line no-console
      console.log(`%c[deleteComponent] Verified deletionLog entry:`, 'color: green', {
        exists: !!written,
        relationshipsJsonLength: (written as any)?.relationshipsJson?.length ?? 0
      });
      
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[deleteComponent] ERROR recording deletion log:`, e);
    }

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
      deleteRelationship(graph, relId as any, { isCascade: true, cascadeFromNodeId: id });

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
    for (const relId of incomingToDeleted) deleteRelationship(graph, relId as any, { isCascade: true, cascadeFromNodeId: id });

    // 5) IMPORTANT: delete ALL remaining incident relationships (any kind)
    // This prevents immediate resurrection in non-concurrent cases.
    const incidentRelIds: string[] = [];
    for (const r of graph.relationships.values()) {
      const src = r.sourceId.value;
      const tgt = r.targetId.value;
      if (src === id || tgt === id) incidentRelIds.push(String(r.id.value));
    }
    for (const rid of incidentRelIds) deleteRelationship(graph, rid as any, { isCascade: true, cascadeFromNodeId: id });

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