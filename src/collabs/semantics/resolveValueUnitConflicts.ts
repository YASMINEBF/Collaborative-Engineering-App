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
    const id = `conf-sem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    graph.conflicts.set(id as any, ConflictKind.SemanticallyRelatedAttributes);
    const c = graph.conflicts.get(id as any);
    if (!c) return;

    c.entityRefs.add(String(compId));
    c.winningValue.value = { key: keyHint };
    c.losingValues.value = candidates.slice();
    c.createdBy.value = currentUserId;
    c.createdAt.value = Date.now();
    c.status.value = "open";

    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("ce:notification", {
            detail: {
              type: "notify",
              title: "Semantic attribute conflict",
              message: `Conflicting values for ${String(compId)} (${keyHint})`,
              compId: String(compId),
              key: keyHint,
            },
          })
        );
      }
    } catch {}
  } else {
    const c = graph.conflicts.get(existingId as any);
    if (c) {
      c.losingValues.value = candidates.slice();
      c.status.value = "open";
      c.createdBy.value = currentUserId;
      c.createdAt.value = Date.now();
    }
  }
}

function clearSemanticConflict(graph: CEngineeringGraph, compId: string, keyHint: string) {
  try {
    const toDelete: string[] = [];
    for (const [cid, conf] of graph.conflicts.entries()) {
      if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;
      const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
      if (!refs.includes(String(compId))) continue;
      if (semanticKeyOf(conf) !== keyHint) continue;
      toDelete.push(String(cid));
    }
    for (const d of toDelete) graph.conflicts.delete(d as any);
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
    }
  } catch {}
}
