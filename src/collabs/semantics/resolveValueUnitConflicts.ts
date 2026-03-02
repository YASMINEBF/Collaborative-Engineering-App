import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

function semanticKeyOf(conf: any): string {
  try {
    const k = conf?.winningValue?.value?.key;
    return typeof k === "string" ? k : "";
  } catch {
    return "";
  }
}

function ensureSemanticConflict(
  graph: CEngineeringGraph,
  compId: string,
  keyHint: string,
  candidates: any[],
  currentUserId: string
) {
  let existingId: string | null = null;
  try {
    for (const [cid, conf] of graph.conflicts.entries()) {
      if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;
      const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
      if (!refs.includes(String(compId))) continue;
      if (semanticKeyOf(conf) !== keyHint) continue;
      existingId = String(cid);
      break;
    }
  } catch {}

  if (!existingId) {
    const id = `conf-sem-${compId}-${keyHint}.toString(16).slice(2)}`;
    graph.conflicts.set(id as any, ConflictKind.SemanticallyRelatedAttributes);
    const c = graph.conflicts.get(id as any);
    if (!c) return;

    c.entityRefs.add(String(compId));
    c.winningValue.value = { key: keyHint };
    c.losingValues.value = candidates.slice();
    c.createdBy.value = currentUserId;
    c.createdAt.value = Date.now();
    c.status.value = "open";
    // NotificationCenter scans conflicts directly, no need for window event
  } else {
    // Conflict already exists - only update if candidates actually changed
    const c = graph.conflicts.get(existingId as any);
    if (c) {
      const existingCandidates = c.losingValues?.value ?? [];
      const candidatesChanged = JSON.stringify(existingCandidates) !== JSON.stringify(candidates);
      
      if (candidatesChanged) {
        c.losingValues.value = candidates.slice();
        c.status.value = "open";
        c.createdBy.value = currentUserId;
        c.createdAt.value = Date.now();
      }
      // If candidates haven't changed, don't write anything to avoid re-render loop
    }
  }
}
//change this to resolve and not clear / delete 
function clearSemanticConflict(graph: CEngineeringGraph, compId: string, keyHint: string, currentUserId="system") {
  try {
    for (const [, conf] of graph.conflicts.entries()) {
      if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;

      const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
      if (!refs.includes(String(compId))) continue;
      if (semanticKeyOf(conf) !== keyHint) continue;

      if (conf.status.value !== "resolved") {
        conf.status.value = "resolved";
        conf.resolution.value = "auto";
        conf.resolvedBy.value = currentUserId;
        conf.resolvedAt.value = Date.now();
      }
      // optional: conf.losingValues.value = [];
    }
  } catch {}
}


function needsConflict(candidates: any[], differs: (a: any, b: any) => boolean) {
  if (!Array.isArray(candidates) || candidates.length <= 1) return false;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (differs(candidates[i], candidates[j])) return true;
    }
  }
  return false;
}

export default function resolveValueUnitConflicts(graph: CEngineeringGraph, currentUserId = "system") {
  try {
    for (const [compId, comp] of graph.components.entries()) {
      const attrs: any = (comp as any).attrs;
      if (!attrs || typeof attrs.getConflicts !== "function") continue;

      // dims
      try {
        const keyHint = "pair:dims";
        const candidates = attrs.getConflicts(keyHint) ?? [];
        const conflictNeeded = needsConflict(candidates, (a, b) => a?.width !== b?.width && a?.height !== b?.height);
        if (conflictNeeded) ensureSemanticConflict(graph, String(compId), keyHint, candidates, currentUserId);
        else clearSemanticConflict(graph, String(compId), keyHint);
      } catch {}

      // name+desc
      try {
        const keyHint = "pair:nameDesc";
        const candidates = attrs.getConflicts(keyHint) ?? [];
        const conflictNeeded = needsConflict(candidates, (a, b) => a?.name !== b?.name && a?.description !== b?.description);
        if (conflictNeeded) ensureSemanticConflict(graph, String(compId), keyHint, candidates, currentUserId);
        else clearSemanticConflict(graph, String(compId), keyHint);
      } catch {}

      // valueUnit:* keys
      try {
        const keys: string[] = [];
        if (typeof attrs.keys === "function") {
          for (const k of attrs.keys()) keys.push(String(k));
        } else if (typeof attrs.entries === "function") {
          for (const [k] of attrs.entries()) keys.push(String(k));
        }

        for (const k of keys) {
          if (!String(k).startsWith("pair:valueUnit:")) continue;
          const candidates = attrs.getConflicts(k) ?? [];
          const conflictNeeded = needsConflict(candidates, (a, b) => a?.value !== b?.value && a?.unit !== b?.unit);
          if (conflictNeeded) ensureSemanticConflict(graph, String(compId), String(k), candidates, currentUserId);
          else clearSemanticConflict(graph, String(compId), String(k));
        }
      } catch {}

      // Simple conflictable attributes (color, medium, etc.) stored as attr:*
      try {
        const keys: string[] = [];
        if (typeof attrs.keys === "function") {
          for (const k of attrs.keys()) keys.push(String(k));
        } else if (typeof attrs.entries === "function") {
          for (const [k] of attrs.entries()) keys.push(String(k));
        }

        for (const k of keys) {
          if (!String(k).startsWith("attr:")) continue;
          const candidates = attrs.getConflicts(k) ?? [];
          // Conflict if values differ (ignoring metadata like editedBy, editedAt)
          const conflictNeeded = needsConflict(candidates, (a, b) => a?.value !== b?.value);
          if (conflictNeeded) {
            ensureSemanticConflict(graph, String(compId), String(k), candidates, currentUserId);
          } else {
            clearSemanticConflict(graph, String(compId), String(k));
          }
        }
      } catch {}
    }
  } catch {}
}
