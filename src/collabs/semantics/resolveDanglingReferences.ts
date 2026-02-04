import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

// Tune this. 3–10 seconds usually works well for “concurrent sync” windows.
const CONCURRENCY_WINDOW_MS = 5000;

export default function resolveDanglingReferences(graph: CEngineeringGraph, currentUserId = "system") {
  // eslint-disable-next-line no-console
  console.log("%c[resolveDanglingReferences] START", "color: purple; font-weight: bold; font-size: 12px");
  
  // tombstone status is stored on the component itself
  const tombstoneInfo = (id: string): { tombstoned: boolean; deletedBy?: string; deletedAt?: number } => {
    try {
      const c: any = graph.components.get(String(id));
      if (!c) return { tombstoned: false };
      const isDeleted = !!(c.isDeleted?.value ?? false);
      if (!isDeleted) return { tombstoned: false };
      return {
        tombstoned: true,
        deletedBy: c.deletedBy?.value ?? undefined,
        deletedAt: typeof c.deletedAt?.value === "number" ? c.deletedAt.value : undefined,
      };
    } catch {}
    return { tombstoned: false };
  };

  const shouldResurrect = (missingId: string, relObj: any): { ok: boolean; reason?: string } => {
    const rec: any = (graph as any).deletionLog?.get?.(String(missingId));
    if (!rec) return { ok: false, reason: "no deletionLog" };

    const deletedAt = typeof rec.deletedAt === "number" ? rec.deletedAt : null;
    if (!deletedAt) return { ok: false, reason: "no deletedAt" };

    const age = Date.now() - deletedAt;
    if (age > CONCURRENCY_WINDOW_MS) return { ok: false, reason: "outside concurrency window" };

    // Best-effort “different user” check if relationship carries createdBy.
    const delBy = rec.deletedBy ? String(rec.deletedBy) : null;
    const relCreatedBy =
      relObj?.createdBy?.value ??
      relObj?.attrs?.get?.("createdBy") ??
      relObj?.attrs?.createdBy ??
      null;

    if (delBy && relCreatedBy && String(relCreatedBy) === delBy) {
      return { ok: false, reason: "same user" };
    }

    return { ok: true };
  };

  const ensureTombstoneComponent = (id: string, relObj: any) => {
    try {
      const rec: any = (graph as any).deletionLog?.get?.(String(id));
      
      // Parse relationshipsJson if present (new format)
      let parsedRelationships: any[] = [];
      if (rec?.relationshipsJson && typeof rec.relationshipsJson === "string") {
        try { parsedRelationships = JSON.parse(rec.relationshipsJson); } catch {}
      } else if (rec?.relationships && Array.isArray(rec.relationships)) {
        parsedRelationships = rec.relationships;
      }
      
      // eslint-disable-next-line no-console
      console.log(`%c[ensureTombstoneComponent] id=${id}`, "color: orange; font-weight: bold", {
        hasRec: !!rec,
        parsedRelationshipsLength: parsedRelationships.length,
        relationshipIds: parsedRelationships.map((r: any) => r?.id),
      });
      if (!rec) return;

      const gate = shouldResurrect(id, relObj);
      if (!gate.ok) {
        // eslint-disable-next-line no-console
        console.log(`[ensureTombstoneComponent] shouldResurrect gate failed:`, gate.reason);
        return;
      }

      // If it already exists, no need to recreate (but still mark tombstone fields)
      const exists = !!graph.components.get(String(id));
      if (!exists) {
        const type = (rec.type as any) ?? "equipment";
        const uniqueName = rec.uniqueName ? String(rec.uniqueName) : `(deleted) ${id}`;

        graph.components.set(String(id) as any, type, uniqueName);

        try {
          const c: any = graph.components.get(String(id));
          if (c?.position && rec.position) c.position.value = rec.position;
        } catch {}
      }

      // Mark as tombstone
      try {
        const c: any = graph.components.get(String(id));
        if (c?.isDeleted) c.isDeleted.value = true;
        if (c?.deletedAt) c.deletedAt.value = typeof rec.deletedAt === "number" ? rec.deletedAt : Date.now();
        if (c?.deletedBy) c.deletedBy.value = rec.deletedBy ? String(rec.deletedBy) : "unknown";
      } catch {}
      
      // ✅ Resurrect previously-synced edges so user can see the full picture
      // These edges were deleted when the node was deleted, but we restore them
      // as part of the conflict so the user sees everything before deciding.
      for (const snap of parsedRelationships) {
        try {
          const relId = String(snap.id);
          // Only resurrect if the edge doesn't already exist
          if (!graph.relationships.get(relId)) {
            // Check that the OTHER endpoint exists (the tombstone node is `id`)
            const otherId = snap.sourceId === id ? snap.targetId : snap.sourceId;
            const otherExists = !!graph.components.get(String(otherId));
            
            if (otherExists) {
              // eslint-disable-next-line no-console
              console.log(`%c[ensureTombstoneComponent] Resurrecting edge ${relId}`, "color: lime; font-weight: bold");
              
              graph.relationships.set(
                relId as any,
                snap.type ?? "relationship",
                snap.kind,
                snap.sourceId,
                snap.targetId,
                snap.medium ?? null,
                snap.sourceHandle ?? null,
                snap.targetHandle ?? null
              );
            }
          }
        } catch {}
      }
    } catch {}
  };

  try {
    for (const rel of graph.relationships.values()) {
      try {
        const relId = rel.id?.value ?? rel.id;
        const srcId = rel.sourceId?.value;
        const tgtId = rel.targetId?.value;

        const srcStr = srcId != null ? String(srcId) : null;
        const tgtStr = tgtId != null ? String(tgtId) : null;

        // Only resurrect within concurrency window (+ different user best-effort)
        if (srcStr && !graph.components.get(srcStr)) ensureTombstoneComponent(srcStr, rel);
        if (tgtStr && !graph.components.get(tgtStr)) ensureTombstoneComponent(tgtStr, rel);

        const srcExists = !!(srcStr && graph.components.get(srcStr));
        const tgtExists = !!(tgtStr && graph.components.get(tgtStr));

        const srcT = srcStr ? tombstoneInfo(srcStr) : { tombstoned: false };
        const tgtT = tgtStr ? tombstoneInfo(tgtStr) : { tombstoned: false };

        const srcValid = srcExists && !srcT.tombstoned;
        const tgtValid = tgtExists && !tgtT.tombstoned;

        if (srcValid && tgtValid) continue;

        const missing: Array<{ id: string; role: "source" | "target"; tombstoned: boolean; deletedBy?: string }> = [];
        if (srcStr && !srcValid) missing.push({ id: srcStr, role: "source", tombstoned: srcT.tombstoned, deletedBy: srcT.deletedBy });
        if (tgtStr && !tgtValid) missing.push({ id: tgtStr, role: "target", tombstoned: tgtT.tombstoned, deletedBy: tgtT.deletedBy });
        if (missing.length === 0) continue;

        let intendedDeletionBy: string | null = null;
        for (const m of missing) {
          if (m.deletedBy) { intendedDeletionBy = m.deletedBy; break; }
        }

        // Avoid duplicate conflicts for same (relId + missingId)
        for (const m of missing) {
          try {
            let already = false;
            for (const existing of graph.conflicts.values()) {
              try {
                if (existing.kind?.value !== ConflictKind.DanglingReference) continue;
                const refs = existing.entityRefs?.values ? Array.from(existing.entityRefs.values()) : [];
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

            // Add the triggering relationship and the missing/tombstoned node
            c.entityRefs.add(String(relId));
            c.entityRefs.add(String(m.id));
            
            // ✅ Also add ALL relationships connected to this tombstone node
            // so they get deleted if user chooses "Delete both"
            try {
              const rec: any = (graph as any).deletionLog?.get?.(String(m.id));
              let parsedRels: any[] = [];
              if (rec?.relationshipsJson && typeof rec.relationshipsJson === "string") {
                try { parsedRels = JSON.parse(rec.relationshipsJson); } catch {}
              } else if (rec?.relationships && Array.isArray(rec.relationships)) {
                parsedRels = rec.relationships;
              }
              for (const snap of parsedRels) {
                if (snap?.id) {
                  c.entityRefs.add(String(snap.id));
                }
              }
              // Also add any currently live relationships connected to this node
              for (const liveRel of graph.relationships.values()) {
                try {
                  const liveRelId = liveRel.id?.value ?? liveRel.id;
                  const liveSrc = liveRel.sourceId?.value;
                  const liveTgt = liveRel.targetId?.value;
                  if (liveSrc === m.id || liveTgt === m.id) {
                    c.entityRefs.add(String(liveRelId));
                  }
                } catch {}
              }
            } catch {}

            c.winningValue.value = intendedDeletionBy ? { intendedDeletionBy } : null;
            c.losingValues.value = [{
              missingId: m.id,
              role: m.role,
              tombstoned: m.tombstoned,
              note: m.tombstoned
                ? "component was deleted concurrently; preserved as tombstone"
                : "referenced component missing",
            }];

            c.createdBy.value = currentUserId;
            c.createdAt.value = Date.now();
            c.status.value = "open";
          } catch {}
        }
      } catch {}
    }
  } catch {}

  // Second pass: remove conflicts that are no longer valid
  try {
    const pairs: Array<[string, any]> = [];
    try {
      if (typeof graph.conflicts.forEach === "function") {
        graph.conflicts.forEach((v: any, k: any) => pairs.push([String(k), v]));
      } else if (typeof graph.conflicts.entries === "function") {
        for (const [k, v] of graph.conflicts.entries()) pairs.push([String(k), v]);
      }
    } catch {}

    for (const [confId, conf] of pairs) {
      try {
        if (conf.kind?.value !== ConflictKind.DanglingReference) continue;
        const status = conf.status?.value ?? "open";
        if (status !== "open") continue;

        const losing = (conf.losingValues?.value as any) ?? [];
        const missingIds: string[] = [];
        for (const lv of losing) {
          if (lv && (lv.missingId || lv.id)) missingIds.push(String(lv.missingId ?? lv.id));
        }

        let stillInvalid = false;
        for (const mid of missingIds) {
          const exists = !!graph.components.get(mid);
          const tomb = tombstoneInfo(mid).tombstoned;
          if (!exists || tomb) { stillInvalid = true; break; }
        }

        if (!stillInvalid) graph.conflicts.delete(confId);
      } catch {}
    }
  } catch {}
}