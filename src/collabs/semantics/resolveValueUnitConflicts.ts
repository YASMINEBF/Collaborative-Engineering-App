import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Detect concurrent MV-register candidates that represent {value, unit} pairs
 * and record a SemanticallyRelatedAttributes conflict only when at least one
 * pairwise comparison differs in BOTH value and unit.
 *
 * IMPORTANT FIX:
 * - Store a per-conflict `key` hint in `winningValue.value` so we can
 *   clean up conflicts *per key* instead of deleting all semantic conflicts
 *   for a component when a different key has no conflict.
 */
export default function resolveValueUnitConflicts(
  graph: CEngineeringGraph,
  currentUserId = "system"
) {
  // Helper: extract semantic conflict key hint from a stored conflict
  const semanticKeyOf = (conf: any): string => {
    try {
      const k = conf?.winningValue?.value?.key;
      return typeof k === "string" ? k : "";
    } catch {
      return "";
    }
  };

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
                // Also explicitly include common unit-attributes that may
                // be written with capitalized names by the UI.
                keys.push("_valueUnit:Width");
                keys.push("_valueUnit:Height");
                keys.push("_valueUnit:Capacity");

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
                      if (maybeUnit && typeof maybeUnit.value !== "undefined") {
                        propCandidates.push(String(candidate));
                      }
                    } catch (e) {}
                  }
                  for (const p of propCandidates) keys.push(`_valueUnit:${p}`);
                } catch (e) {}
              } catch (e) {
                keys.push("_valueUnit");
              }
            }

            // Build a fast lookup for keys and detect base attrs that have
            // companion Unit keys (e.g. `Width` + `WidthUnit`). For those
            // attributes, synthesize combined candidates from the separate
            // conflicts and apply the same "value+unit both differ"
            // heuristic as for single-map `{value,unit}` entries.
            const keysSet = new Set(keys.map(String));

            // Detect base attribute keys that also have a companion Unit key
            const baseAttrs = Array.from(keysSet).filter(
              (k) =>
                typeof k === "string" &&
                !k.startsWith("_") &&
                !k.endsWith("Unit") &&
                keysSet.has(`${k}Unit`)
            );

            for (const attr of baseAttrs) {
              try {
                const vCandidates = map.getConflicts(attr) ?? [];
                const uCandidates = map.getConflicts(`${attr}Unit`) ?? [];
                if (
                  !Array.isArray(vCandidates) ||
                  !Array.isArray(uCandidates) ||
                  vCandidates.length === 0 ||
                  uCandidates.length === 0
                )
                  continue;

                const merged: any[] = [];
                for (const v of vCandidates) {
                  for (const u of uCandidates) {
                    merged.push({
                      value: v?.value ?? v?.val ?? null,
                      unit: u?.value ?? u?.val ?? null,
                      raw: { v, u },
                    });
                  }
                }

                if (merged.length > 1) {
                  let conflictNeeded = false;
                  outerMerged: for (let i = 0; i < merged.length; i++) {
                    for (let j = i + 1; j < merged.length; j++) {
                      const a = merged[i];
                      const b = merged[j];
                      const valueDiff = a.value !== b.value;
                      const unitDiff = a.unit !== b.unit;
                      if (valueDiff && unitDiff) {
                        conflictNeeded = true;
                        break outerMerged;
                      }
                    }
                  }

                  if (conflictNeeded) {
                    try {
                      // eslint-disable-next-line no-console
                      console.info(
                        "resolveValueUnitConflicts: detected split value/unit semantic conflict",
                        { compId: String(compId), attr }
                      );
                    } catch (e) {}

                    // Key hint for this synthetic merged conflict
                    const keyHint = `_valueUnit:${String(attr)}`;

                    let already = false;
                    try {
                      for (const existing of graph.conflicts.values()) {
                        try {
                          if (
                            existing.kind?.value !==
                            ConflictKind.SemanticallyRelatedAttributes
                          )
                            continue;
                          const refs = existing.entityRefs?.values
                            ? Array.from(existing.entityRefs.values())
                            : [];
                          if (!refs.includes(String(compId))) continue;
                          // IMPORTANT: only treat as "already" if it's for the same key
                          if (semanticKeyOf(existing) === keyHint) {
                            already = true;
                            break;
                          }
                        } catch {}
                      }
                    } catch {}

                    if (!already) {
                      const id = `conf-vu-${Date.now()}-${Math.random()
                        .toString(16)
                        .slice(2)}`;
                      try {
                        graph.conflicts.set(
                          id,
                          ConflictKind.SemanticallyRelatedAttributes
                        );
                        const c = graph.conflicts.get(id);
                        if (c) {
                          c.entityRefs.add(String(compId));
                          // Store key hint so UI/dedup/cleanup can be precise
                          c.winningValue.value = { key: keyHint };
                          c.losingValues.value = merged.slice();
                          c.createdBy.value = currentUserId;
                          c.createdAt.value = Date.now();
                          c.status.value = "open";
                        }

                        try {
                          if (typeof window !== "undefined") {
                            const ev = new CustomEvent("ce:notification", {
                              detail: {
                                type: "notify",
                                title: "Attribute conflict",
                                message: `Conflicting attribute value/unit for component: ${String(
                                  compId
                                )} (attr: ${String(attr)})`,
                                compId: String(compId),
                                key: keyHint,
                              },
                            });
                            window.dispatchEvent(ev as any);
                          }
                        } catch (e) {}
                      } catch (e) {}
                    }
                  } else {
                    // If no conflict for this synthesized key, clean up ONLY that key
                    try {
                      const keyHint = `_valueUnit:${String(attr)}`;
                      const toDelete: string[] = [];
                      for (const [confId, conf] of graph.conflicts.entries()) {
                        try {
                          if (
                            conf.kind?.value !==
                            ConflictKind.SemanticallyRelatedAttributes
                          )
                            continue;
                          const refs = conf.entityRefs?.values
                            ? Array.from(conf.entityRefs.values())
                            : [];
                          if (!refs.includes(String(compId))) continue;
                          if (semanticKeyOf(conf) !== keyHint) continue;
                          toDelete.push(String(confId));
                        } catch {}
                      }
                      for (const d of toDelete) graph.conflicts.delete(d as any);
                    } catch (e) {}
                  }
                }
              } catch (e) {}
            }

            for (const key of keys) {
              try {
                const candidates = map.getConflicts(key) ?? [];
                if (!Array.isArray(candidates) || candidates.length <= 1) continue;

                // Determine which pair shape we're checking by key
                let conflictNeeded = false;

                if (
                  String(key).startsWith("_valueUnit") ||
                  String(key).startsWith("_valueUnit:")
                ) {
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
                } else if (
                  String(key) === "_nameDesc" ||
                  String(key).startsWith("_nameDesc:")
                ) {
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
                  try {
                    // eslint-disable-next-line no-console
                    console.info("resolveValueUnitConflicts: detected semantic conflict", {
                      compId: String(compId),
                      key,
                    });
                  } catch (e) {}

                  const keyHint = String(key);

                  let already = false;
                  try {
                    for (const existing of graph.conflicts.values()) {
                      try {
                        if (
                          existing.kind?.value !==
                          ConflictKind.SemanticallyRelatedAttributes
                        )
                          continue;
                        const refs = existing.entityRefs?.values
                          ? Array.from(existing.entityRefs.values())
                          : [];
                        if (!refs.includes(String(compId))) continue;
                        // IMPORTANT: only treat as "already" if it's for the same key
                        if (semanticKeyOf(existing) === keyHint) {
                          already = true;
                          break;
                        }
                      } catch {}
                    }
                  } catch {}

                  if (!already) {
                    const id = `conf-vu-${Date.now()}-${Math.random()
                      .toString(16)
                      .slice(2)}`;
                    try {
                      graph.conflicts.set(id, ConflictKind.SemanticallyRelatedAttributes);
                      const c = graph.conflicts.get(id);
                      if (c) {
                        c.entityRefs.add(String(compId));
                        // Store key hint so UI/dedup/cleanup can be precise
                        c.winningValue.value = { key: keyHint };
                        c.losingValues.value = candidates.slice();
                        c.createdBy.value = currentUserId;
                        c.createdAt.value = Date.now();
                        c.status.value = "open";
                      }

                      // Dispatch a UI notification event so NotificationCenter sees it reliably
                      try {
                        if (typeof window !== "undefined") {
                          const ev = new CustomEvent("ce:notification", {
                            detail: {
                              type: "notify",
                              title: "Attribute conflict",
                              message: `Conflicting attribute values for component: ${String(
                                compId
                              )} (key: ${String(key)})`,
                              compId: String(compId),
                              key: keyHint,
                            },
                          });
                          window.dispatchEvent(ev as any);
                        }
                      } catch (e) {}
                    } catch (e) {}
                  }
                } else {
                  // cleanup existing conflict(s) for this comp/key if present
                  // IMPORTANT FIX: only delete semantic conflicts for the SAME key
                  try {
                    const keyHint = String(key);
                    const toDelete: string[] = [];
                    for (const [confId, conf] of graph.conflicts.entries()) {
                      try {
                        if (
                          conf.kind?.value !==
                          ConflictKind.SemanticallyRelatedAttributes
                        )
                          continue;
                        const refs = conf.entityRefs?.values
                          ? Array.from(conf.entityRefs.values())
                          : [];
                        if (!refs.includes(String(compId))) continue;
                        if (semanticKeyOf(conf) !== keyHint) continue;
                        toDelete.push(String(confId));
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
