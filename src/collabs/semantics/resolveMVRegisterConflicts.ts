import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Minimal helper to apply a chosen MV-register winner for a component and
 * mark related SemanticallyRelatedAttributes conflicts resolved.
 *
 * IMPORTANT FIX:
 * - Only resolve SemanticallyRelatedAttributes conflicts that match the same
 *   semantic key we are resolving (foundKey / derived keyHint). Previously this
 *   resolved *all* semantic conflicts for the component, which could make the
 *   UI never show "open" conflicts / notifications.
 */
export function applyMVRegisterResolution(
  graph: CEngineeringGraph,
  compId: string,
  chosenValue: any,
  currentUserId = "system"
) {
  const comp = graph.components.get(compId as any);
  if (!comp) return false;

  const deepEqual = (a: any, b: any) => {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch { return a === b; }
  };

  // Only map we *know* exists on all components
  const foundMap: any = (comp as any).attrs;
  if (!foundMap || typeof foundMap.getConflicts !== "function" || typeof foundMap.set !== "function") {
    return false;
  }

  // Find which key in attrs contains chosenValue among conflicts
  let foundKey: string | null = null;
  try {
    const keys: string[] = [];
    if (typeof foundMap.entries === "function") {
      for (const [k] of foundMap.entries()) keys.push(String(k));
    } else if (typeof foundMap.keys === "function") {
      for (const k of foundMap.keys()) keys.push(String(k));
    } else {
      keys.push("_dims", "_nameDesc", "_valueUnit");
    }

    for (const k of keys) {
      const candidates = foundMap.getConflicts(k) ?? [];
      for (const c of candidates) {
        if (deepEqual(c, chosenValue)) {
          foundKey = String(k);
          break;
        }
      }
      if (foundKey) break;
    }
  } catch {}

  if (!foundKey) return false;

  // Apply winner to the map MV-register
  try { foundMap.set(foundKey, chosenValue); } catch {}

  // Resolve only matching semantic conflicts (same comp + same key)
  const keyHint = String(foundKey);
  const semanticKeyOf = (conf: any) => {
    try { return typeof conf?.winningValue?.value?.key === "string" ? conf.winningValue.value.key : ""; }
    catch { return ""; }
  };

  try {
    for (const [, conf] of graph.conflicts.entries()) {
      if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;

      const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
      if (!refs.includes(String(compId))) continue;

      const confKey = semanticKeyOf(conf);
      if (confKey && confKey !== keyHint) continue;

      const prevWinning = conf.winningValue?.value ?? {};
      conf.winningValue.value =
        typeof prevWinning === "object" && prevWinning !== null
          ? { ...prevWinning, key: confKey || keyHint, chosenValue }
          : { key: confKey || keyHint, chosenValue };

      conf.status.value = "resolved";
      conf.createdBy.value = currentUserId;
      conf.createdAt.value = Date.now();
    }
  } catch {}

  return true;
}


export default function resolveMVRegisterConflicts(graph: CEngineeringGraph, currentUserId = "system") {
  // No-op placeholder kept for compatibility.
  return;
}
