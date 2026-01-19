import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Detect concurrent MV-register candidates that represent {value, unit} pairs
 * and record a SemanticallyRelatedAttributes conflict only when at least one
 * pairwise comparison differs in BOTH value and unit.
 */
export default function resolveValueUnitConflicts(graph: CEngineeringGraph, currentUserId = "system") {
  try {
    for (const [compId, comp] of graph.components.entries()) {
      try {
        // Inspect properties of component to find CValueMap-like fields
        for (const prop of Object.keys(comp)) {
          try {
            const map = (comp as any)[prop];
            if (!map || typeof map.getConflicts !== "function") continue;

            // Try to iterate keys for this map. Prefer entries()/keys(), fall back
            // to a singleton conventional key if neither exists.
            const keys: string[] = [];
            try {
              if (typeof map.entries === "function") {
                for (const [k] of map.entries()) keys.push(String(k));
              } else if (typeof map.keys === "function") {
                for (const k of map.keys()) keys.push(String(k));
              }
            } catch (e) {}
            if (keys.length === 0) {
              // Fallback: try common semantic keys that the UI may write into
              // even when the map doesn't expose entries(). These include
              // `_dims`, `_nameDesc`, and per-attribute `_valueUnit:<attr>`.
              try {
                keys.push("_dims");
                keys.push("_nameDesc");
                // Inspect component for properties that have a companion unit CVar
                // (e.g. `length` with `lengthUnit`) so we can check
                // `_valueUnit:<prop>` keys for any unit-typed attribute written
                // by the UI, not just hard-coded names.
                try {
                  const propCandidates: string[] = [];
                  for (const candidate of Object.keys(comp)) {
                    if (String(candidate).endsWith("Unit")) continue;
                    try {
                      const maybeUnit = (comp as any)[`${candidate}Unit`];
                      if (maybeUnit && typeof maybeUnit.value !== "undefined") propCandidates.push(String(candidate));
                    } catch (e) {}
                  }
                  for (const p of propCandidates) keys.push(`_valueUnit:${p}`);
                } catch (e) {}
              } catch (e) {
                keys.push("_valueUnit");
              }
            }

            for (const key of keys) {
              try {
                const candidates = map.getConflicts(key) ?? [];
                if (!Array.isArray(candidates) || candidates.length <= 1) continue;

                // Determine which pair shape we're checking by key
                let conflictNeeded = false;

                if (String(key).startsWith("_valueUnit") || String(key).startsWith("_valueUnit:")) {
                  // Normalize to { value, unit }
                  const norm = candidates.map((c: any) => ({
                    value: c?.value ?? (c?.val ?? null),
                    unit: c?.unit ?? (c?.u ?? null),
                    raw: c,
                  }));

                  outer: for (let i = 0; i < norm.length; i++) {
                    for (let j = i + 1; j < norm.length; j++) {
                      const a = norm[i];
                      const b = norm[j];
                      const valueDiff = a.value !== b.value;
                      const unitDiff = a.unit !== b.unit;
                      if (valueDiff && unitDiff) {
                        conflictNeeded = true;
                        break outer;
                      }
                    }
                  }
                } else if (String(key) === "_dims" || String(key).startsWith("_dims:")) {
                  // Normalize to { width, height }
                  const norm = candidates.map((c: any) => ({
                    width: c?.width ?? c?.w ?? null,
                    height: c?.height ?? c?.h ?? null,
                    raw: c,
                  }));

                  outer: for (let i = 0; i < norm.length; i++) {
                    for (let j = i + 1; j < norm.length; j++) {
                      const a = norm[i];
                      const b = norm[j];
                      const widthDiff = a.width !== b.width;
                      const heightDiff = a.height !== b.height;
                      if (widthDiff && heightDiff) {
                        conflictNeeded = true;
                        break outer;
                      }
                    }
                  }
                } else if (String(key) === "_nameDesc" || String(key).startsWith("_nameDesc:")) {
                  // Normalize to { name, description }
                  const norm = candidates.map((c: any) => ({
                    name: c?.name ?? c?.n ?? null,
                    description: c?.description ?? c?.desc ?? null,
                    raw: c,
                  }));

                  outer: for (let i = 0; i < norm.length; i++) {
                    for (let j = i + 1; j < norm.length; j++) {
                      const a = norm[i];
                      const b = norm[j];
                      const nameDiff = a.name !== b.name;
                      const descDiff = a.description !== b.description;
                      if (nameDiff && descDiff) {
                        conflictNeeded = true;
                        break outer;
                      }
                    }
                  }
                } else {
                  // Default: try value/unit semantics
                  const norm = candidates.map((c: any) => ({
                    value: c?.value ?? (c?.val ?? null),
                    unit: c?.unit ?? (c?.u ?? null),
                    raw: c,
                  }));
                  outer: for (let i = 0; i < norm.length; i++) {
                    for (let j = i + 1; j < norm.length; j++) {
                      const a = norm[i];
                      const b = norm[j];
                      const valueDiff = a.value !== b.value;
                      const unitDiff = a.unit !== b.unit;
                      if (valueDiff && unitDiff) {
                        conflictNeeded = true;
                        break outer;
                      }
                    }
                  }
                }

                // Create conflict if needed and not already present
                if (conflictNeeded) {
                  // Debug: log conflict detection
                  try {
                    // eslint-disable-next-line no-console
                    console.info("resolveValueUnitConflicts: detected semantic conflict", { compId: String(compId), key });
                  } catch (e) {}
                  let already = false;
                  try {
                    for (const existing of graph.conflicts.values()) {
                      try {
                        if (existing.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;
                        const refs = existing.entityRefs?.values ? Array.from(existing.entityRefs.values()) : [];
                        if (refs.includes(String(compId))) {
                          already = true;
                          break;
                        }
                      } catch {}
                    }
                  } catch {}

                  if (!already) {
                    const id = `conf-vu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                    try {
                      graph.conflicts.set(id, ConflictKind.SemanticallyRelatedAttributes);
                      const c = graph.conflicts.get(id);
                      if (c) {
                        c.entityRefs.add(String(compId));
                        c.winningValue.value = null;
                        c.losingValues.value = candidates.slice();
                        c.createdBy.value = currentUserId;
                        c.createdAt.value = Date.now();
                        c.status.value = "open";
                      }
                      // Dispatch a UI notification event so NotificationCenter sees it reliably
                      try {
                        const ev = new CustomEvent("ce:notification", {
                          detail: {
                            type: "notify",
                            title: "Attribute conflict",
                            message: `Conflicting attribute values for component: ${String(compId)} (key: ${String(key)})`,
                            compId: String(compId),
                            key: String(key),
                          },
                        });
                        window.dispatchEvent(ev as any);
                      } catch (e) {}
                    } catch (e) {}
                  }
                } else {
                  // cleanup existing conflict(s) for this comp/key if present
                  try {
                    const toDelete: string[] = [];
                    for (const [confId, conf] of graph.conflicts.entries()) {
                      try {
                        if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;
                        const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
                        if (refs.includes(String(compId))) {
                          toDelete.push(String(confId));
                        }
                      } catch {}
                    }
                    for (const d of toDelete) graph.conflicts.delete(d as any);
                  } catch (e) {}
                }
              } catch (e) {}
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
}
