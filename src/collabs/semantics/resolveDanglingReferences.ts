import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Detect relationships whose source or target refers to a non-existent
 * component (dangling reference). Do NOT delete the relationship; instead
 * record a `DanglingReference` conflict that lists the relationship and the
 * missing component. If possible, include a best-effort `intendedDeletionBy`
 * field when another conflict or record suggests who deleted the component.
 */
export default function resolveDanglingReferences(graph: CEngineeringGraph, currentUserId = "system") {
  try {
    for (const rel of graph.relationships.values()) {
      try {
        const relId = rel.id?.value ?? rel.id;
        const srcId = rel.sourceId?.value;
        const tgtId = rel.targetId?.value;

        const srcExists = typeof srcId !== "undefined" && srcId !== null && !!graph.components.get(srcId);
        const tgtExists = typeof tgtId !== "undefined" && tgtId !== null && !!graph.components.get(tgtId);

        // If both endpoints exist, nothing to do
        if (srcExists && tgtExists) continue;

        // For each missing endpoint, create (or ensure) a DanglingReference conflict
        const missing: Array<{ id: string; role: "source" | "target" }> = [];
        if (!srcExists && srcId) missing.push({ id: srcId, role: "source" });
        if (!tgtExists && tgtId) missing.push({ id: tgtId, role: "target" });

        if (missing.length === 0) continue;

        // Best-effort: try to find an existing conflict that indicates someone
        // intended to delete the missing component (look for conflicts that
        // reference the missing id and have a createdBy).
        let intendedDeletionBy: string | null = null;
        try {
          for (const c of graph.conflicts.values()) {
            try {
              const refs = c.entityRefs?.values ? Array.from(c.entityRefs.values()) : [];
              for (const m of missing) {
                if (refs.includes(String(m.id))) {
                  const cb = c.createdBy?.value ?? null;
                  if (cb) {
                    intendedDeletionBy = String(cb);
                    break;
                  }
                }
              }
              if (intendedDeletionBy) break;
            } catch {}
          }
        } catch {}

        // Avoid duplicate conflicts for the same relationship + missing id
        for (const m of missing) {
          try {
            let already = false;
            for (const existing of graph.conflicts.values()) {
              try {
                if (existing.kind?.value !== ConflictKind.DanglingReference) continue;
                const refs = existing.entityRefs?.values ? Array.from(existing.entityRefs.values()) : [];
                // If this existing conflict already references our relationship
                // and the missing component, consider it already recorded.
                if (refs.includes(String(relId)) && refs.includes(String(m.id))) {
                  already = true;
                  break;
                }
              } catch {}
            }

            if (already) continue;

            const id = `conf-dangling-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            graph.conflicts.set(id, ConflictKind.DanglingReference);
            const c = graph.conflicts.get(id);
            if (!c) continue;

            c.entityRefs.add(String(relId));
            c.entityRefs.add(String(m.id));
            c.winningValue.value = null;
            c.losingValues.value = [{ missingId: m.id, role: m.role, note: "referenced component missing" }];
            if (intendedDeletionBy) c.winningValue.value = { intendedDeletionBy };
            c.createdBy.value = currentUserId;
            c.createdAt.value = Date.now();
            c.status.value = "open";
          } catch (e) {}
        }
      } catch (e) {
        // ignore per-relationship errors
      }
    }
  } catch (e) {}

  // Second pass: remove dangling conflicts that are no longer valid
  try {
    const pairs: Array<[string, any]> = [];
    try {
      if (typeof graph.conflicts.forEach === "function") {
        graph.conflicts.forEach((v: any, k: any) => pairs.push([String(k), v]));
      } else if (typeof graph.conflicts.entries === "function") {
        for (const [k, v] of graph.conflicts.entries()) pairs.push([String(k), v]);
      }
    } catch (e) {}

    for (const [confId, conf] of pairs) {
      try {
        if (conf.kind?.value !== ConflictKind.DanglingReference) continue;
        const status = conf.status?.value ?? "open";
        if (status !== "open") continue;

        // Determine the component ids this conflict was created for. We record
        // them in `losingValues` when creating the conflict (as `missingId`).
        // Use those to decide whether the missing component still does not
        // exist. This avoids misinterpreting a removed relationship id as a
        // missing component.
        let stillMissing = false;
        try {
          const losing = (conf.losingValues?.value as any) ?? [];
          const missingIds: string[] = [];
          for (const lv of losing) {
            try {
              if (lv && (lv.missingId || lv.id)) missingIds.push(String(lv.missingId ?? lv.id));
            } catch {}
          }

          // If we have explicit missing ids recorded, consider the conflict
          // resolved only when none of those ids are missing anymore.
          if (missingIds.length > 0) {
            for (const mid of missingIds) {
              if (!graph.components.get(mid)) {
                stillMissing = true;
                break;
              }
            }
          } else {
            // Fallback: if no losingValues recorded, conservatively keep the
            // conflict if any referenced id (that is a component) is missing.
            for (const ref of conf.entityRefs?.values ? conf.entityRefs.values() : []) {
              const r = String(ref);
              if (graph.components.get(r)) {
                if (!graph.components.get(r)) {
                  stillMissing = true;
                  break;
                }
              }
            }
          }
        } catch (e) {}

        if (!stillMissing) {
          try {
            graph.conflicts.delete(confId);
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
}
