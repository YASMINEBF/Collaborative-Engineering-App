import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Minimal helper to apply a chosen MV-register winner for a component and
 * mark related SemanticallyRelatedAttributes conflicts resolved.
 */
export function applyMVRegisterResolution(
  graph: CEngineeringGraph,
  compId: string,
  chosenValue: any,
  currentUserId = "system"
) {
  try {
    const comp = graph.components.get(compId as any);
    if (!comp) return false;
    // Attempt to find the MV map/key that originally held `chosenValue` by
    // scanning all MV-like fields on the component. If we can't locate the
    // exact key, fall back to heuristics (dims/nameDesc/valueUnit).
    const deepEqual = (a: any, b: any) => {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch (e) {
        return a === b;
      }
    };

    let foundMap: any = null;
    let foundKey: string | null = null;

    for (const p of Object.keys(comp)) {
      try {
        const m = (comp as any)[p];
        if (!m || typeof m.getConflicts !== "function" || typeof m.set !== "function") continue;

        // Collect candidate keys for this map
        const keys: string[] = [];
        try {
          if (typeof m.entries === "function") {
            for (const [k] of m.entries()) keys.push(String(k));
          } else if (typeof m.keys === "function") {
            for (const k of m.keys()) keys.push(String(k));
          } else {
            // Fall back to conventional semantic keys
            keys.push("_dims");
            keys.push("_nameDesc");
            for (const candidate of Object.keys(comp)) {
              if (String(candidate).endsWith("Unit")) continue;
              try {
                const maybeUnit = (comp as any)[`${candidate}Unit`];
                if (maybeUnit && typeof maybeUnit.value !== "undefined") keys.push(`_valueUnit:${candidate}`);
              } catch (e) {}
            }
            keys.push("_valueUnit");
          }
        } catch (e) {}

        for (const k of keys) {
          try {
            const candidates = m.getConflicts ? (m.getConflicts(k) ?? []) : [];
            for (const c of candidates) {
              if (deepEqual(c, chosenValue)) {
                foundMap = m;
                foundKey = String(k);
                break;
              }
            }
            if (foundMap) break;
          } catch (e) {}
        }
        if (foundMap) break;
      } catch (e) {}
    }

    // Heuristics: choose a sensible map/key if we couldn't match the candidate
    if (!foundMap) {
      // prefer `dimensions` or `attrs` if present
      foundMap = (comp as any)?.dimensions ?? (comp as any)?.attrs ?? null;
      if (!foundMap) {
        for (const p of Object.keys(comp)) {
          try {
            const m = (comp as any)[p];
            if (!m) continue;
            if (typeof m.getConflicts === "function" && typeof m.set === "function") {
              foundMap = m;
              break;
            }
          } catch (e) {}
        }
      }

      if (chosenValue && typeof chosenValue === "object") {
        if ("width" in chosenValue || "height" in chosenValue) {
          foundKey = (comp as any).dimsKey ? (comp as any).dimsKey() : "_dims";
        } else if ("name" in chosenValue || "description" in chosenValue) {
          foundKey = "_nameDesc";
        } else if ("value" in chosenValue || "unit" in chosenValue) {
          // Try generic `_valueUnit` first, else pick the first attr with a Unit companion
          try {
            if (foundMap && typeof foundMap.getConflicts === "function" && Array.isArray(foundMap.getConflicts("_valueUnit") ?? [])) {
              foundKey = "_valueUnit";
            } else {
              for (const candidate of Object.keys(comp)) {
                if (String(candidate).endsWith("Unit")) continue;
                try {
                  const maybeUnit = (comp as any)[`${candidate}Unit`];
                  if (maybeUnit && typeof maybeUnit.value !== "undefined") {
                    foundKey = `_valueUnit:${candidate}`;
                    break;
                  }
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      }
    }

    if (!foundMap || !foundKey) return false;

    try {
      foundMap.set(foundKey, chosenValue);
    } catch (e) {
      // best-effort
    }


    // Update matching conflicts to resolved
    try {
      for (const [confId, conf] of graph.conflicts.entries()) {
        try {
          if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;
          // check if this conflict references the component
          const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
          if (!refs.includes(String(compId))) continue;

          // populate losingValues if missing
          try {
            const prev = conf.losingValues?.value ?? [];
            if (!Array.isArray(prev) || prev.length === 0) {
              const candidates = foundMap.getConflicts ? (foundMap.getConflicts(foundKey) ?? []) : [];
              conf.losingValues.value = candidates.slice();
            }
          } catch (e) {}

          conf.winningValue.value = chosenValue;
          conf.status.value = "resolved";
          conf.createdBy.value = currentUserId;
          conf.createdAt.value = Date.now();
        } catch (e) {}
      }
    } catch (e) {}

    return true;
  } catch (e) {
    return false;
  }
}

export default function resolveMVRegisterConflicts(graph: CEngineeringGraph, currentUserId = "system") {
  // No-op placeholder kept for compatibility.
  return;
}
