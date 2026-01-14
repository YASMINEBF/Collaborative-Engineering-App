import type { CEngineeringGraph, ComponentId } from "../model/CEngineeringGraph";
import type { Medium } from "../../models/attributes/enums/Medium";
import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";

export type MediaValidationResult = {
  allowed: boolean;
  message?: string;
  conflictingRelationshipIds?: string[];
};

/**
 * Validate whether changing an equipment's input/output medium is safe
 * with respect to existing Feeds relationships in the graph.
 *
 * - If blocked, returns `{ allowed: false, message, conflictingRelationshipIds }`.
 * - If allowed, returns `{ allowed: true }`.
 */
export function validateEquipmentMediaChange(
  graph: CEngineeringGraph,
  equipmentId: ComponentId,
  newInput: Medium,
  newOutput: Medium
): MediaValidationResult {
  const comp = graph.components.get(equipmentId);
  if (!comp) return { allowed: false, message: "Equipment not found" };

  const oldInput = (comp as any).inputMedium?.value;
  const oldOutput = (comp as any).outputMedium?.value;

  const blocking: string[] = [];

  // Check feeds that target this equipment when input will change
  if (newInput !== oldInput) {
    for (const rel of graph.relationships.values()) {
      try {
        if (rel.kind?.value !== PhysicalKind.Feeds) continue;
        if (rel.targetId?.value !== equipmentId) continue;

        const relMedium = rel.medium?.value;
        if (relMedium === oldInput) {
          blocking.push(rel.id?.value ?? rel.id ?? "?");
          continue;
        }

        if (relMedium == null) {
          const src = graph.components.get(rel.sourceId?.value ?? "");
          const srcOut = (src as any)?.outputMedium?.value;
          if (srcOut === oldInput) blocking.push(rel.id?.value ?? rel.id ?? "?");
        }
      } catch (e) {
        // ignore iteration errors
      }
    }
  }

  // Check feeds that source from this equipment when output will change
  if (newOutput !== oldOutput) {
    for (const rel of graph.relationships.values()) {
      try {
        if (rel.kind?.value !== PhysicalKind.Feeds) continue;
        if (rel.sourceId?.value !== equipmentId) continue;

        const relMedium = rel.medium?.value;
        if (relMedium === oldOutput) {
          blocking.push(rel.id?.value ?? rel.id ?? "?");
          continue;
        }

        if (relMedium == null) {
          const tgt = graph.components.get(rel.targetId?.value ?? "");
          const tgtIn = (tgt as any)?.inputMedium?.value;
          if (tgtIn === oldOutput) blocking.push(rel.id?.value ?? rel.id ?? "?");
        }
      } catch (e) {}
    }
  }

  if (blocking.length > 0) {
    const message = `Blocked: ${blocking.length} feeds relationship(s) depend on the current medium.`;
    return { allowed: false, message, conflictingRelationshipIds: blocking };
  }

  return { allowed: true };
}

/**
 * Helper to validate and dispatch a small `ce:notification` if blocked.
 * Returns `true` when change is allowed (caller may apply), otherwise `false`.
 */
export function validateAndNotifyIfBlocked(
  graph: CEngineeringGraph,
  equipmentId: ComponentId,
  newInput: Medium,
  newOutput: Medium
): boolean {
  const res = validateEquipmentMediaChange(graph, equipmentId, newInput, newOutput);
  if (!res.allowed) {
    const title = "Cannot change medium";
    const message = res.message ?? "Change blocked due to dependent feeds relationships.";
    window.dispatchEvent(new CustomEvent("ce:notification", { detail: { type: "notify", title, message } }));
    return false;
  }
  return true;
}
