import { useEffect, useState, useRef } from "react";
import "./notification.css";
import { useCollab } from "../../collabs/provider/CollabProvider";
import { ConflictKind } from "../../collabs/model/enums/ConflictEnum";

type Notification = {
  id: string;
  title?: string;
  message: string;
  ts: number;
  conflictId?: string;
  kind?: string;
};

export function NotificationCenter() {
  const [items, setItems] = useState<Notification[]>([]);
  const { doc, graph, resolveConflictAction } = useCollab();

  // Keep a map of notification signatures -> timestamp to dedupe repeated
  // notifications originating from events or CRDT conflict scans. Entries
  // older than NOTIF_TTL_MS are considered expired and can be re-notified.
  const NOTIF_TTL_MS = 60_000; // 60s
  const notifiedRef = useRef<Map<string, number>>(new Map());

  // Listen for window-dispatched events (fallback / other UI code)
  useEffect(() => {
    function onEvent(e: any) {
      const d = e.detail;
      if (!d) return;
      try {
        // eslint-disable-next-line no-console
        console.info("NotificationCenter: received ce:notification event", d);
      } catch (e) {}
      // Support different notification event shapes. Existing callers emit
      // `{ type: 'rename', oldName, newName, affectedId }`. We also accept
      // `{ type: 'notify', title, message }` for arbitrary UI notifications.
      if (d.type === "rename") {
        const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const title = "Name conflict resolved";
        const message = `"${d.oldName}" → "${d.newName}" (id: ${d.affectedId})`;
        const n = { id, title, message, ts: Date.now() };
        // Deduplicate by event signature
        const sig = `event:rename:${d.affectedId}:${d.oldName}:${d.newName}`;
        const now = Date.now();
        // cleanup expired
        for (const [k, t] of notifiedRef.current.entries()) if (now - t > NOTIF_TTL_MS) notifiedRef.current.delete(k);
        if (!notifiedRef.current.has(sig)) {
          notifiedRef.current.set(sig, now);
          setItems((s) => [n, ...s].slice(0, 6));
        }

        // Auto-remove after 6s
        setTimeout(() => {
          setItems((s) => s.filter((x) => x.id !== id));
        }, 6000);
      } else if (d.type === "notify") {
        const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const title = d.title ?? "Notification";
        const message = d.message ?? "";
        const n = { id, title, message, ts: Date.now() };

        // Build an event signature to dedupe similar notify events
        const sig = `event:notify:${d.compId ?? ""}:${d.key ?? ""}:${title}:${message}`;
        const now = Date.now();
        for (const [k, t] of notifiedRef.current.entries()) if (now - t > NOTIF_TTL_MS) notifiedRef.current.delete(k);
        if (!notifiedRef.current.has(sig)) {
          notifiedRef.current.set(sig, now);
          setItems((s) => [n, ...s].slice(0, 6));

          setTimeout(() => {
            setItems((s) => s.filter((x) => x.id !== id));
          }, 6000);
        }
      }
    }

    window.addEventListener("ce:notification", onEvent as any);
    return () => window.removeEventListener("ce:notification", onEvent as any);
  }, []);

  // Preferred: observe the collab `graph.conflicts` so UI reacts to authoritative CConflict instances
  useEffect(() => {
    if (!graph || !doc) return;

    let lastSeen = Date.now() - 1000;
    // Use a shared notified map (kept in ref) to avoid duplicate toasts between
    // the event handler above and this CRDT scanning loop. Values older than
    // NOTIF_TTL_MS are expired and can be re-notified.
    const now = Date.now();
    for (const [k, t] of notifiedRef.current.entries()) if (now - t > NOTIF_TTL_MS) notifiedRef.current.delete(k);

    // Helper to scan existing conflicts for recent resolved duplicate-name entries
    const scanConflicts = () => {
      try {
        // Iterate entries so we can dedupe by the conflict id (avoid showing
        // the same conflict twice when it arrives via event + CRDT scan).
        const entries: Array<[string, any]> = [];
        try {
          if (typeof graph.conflicts.entries === "function") {
            for (const [k, v] of graph.conflicts.entries()) entries.push([String(k), v]);
          } else if (typeof graph.conflicts.forEach === "function") {
            graph.conflicts.forEach((v: any, k: any) => entries.push([String(k), v]));
          }
        } catch (e) {}

        for (const [confId, conf] of entries) {
          try {
            const kind = conf.kind?.value;
            const createdAt = conf.createdAt?.value ?? 0;
            const status = conf.status?.value ?? "open";

            // Dedupe by conflict id first: if we've already notified for
            // this conflict id, skip producing another toast.
            const confKey = `conf:${confId}`;
            if (notifiedRef.current.has(confKey)) {
              // Update lastSeen to avoid re-notifying on createdAt
              lastSeen = Math.max(lastSeen, createdAt);
              continue;
            }

            // Resolved duplicate-name notifications (existing behavior)
            if (kind === ConflictKind.DuplicateName) {
              if (status !== "resolved") continue;
              if (createdAt <= lastSeen) continue;

              const losing = (conf.losingValues?.value as any) ?? [];
              for (const lv of losing) {
                const id = lv.id ?? lv["id"] ?? "?";
                const oldName = lv.oldName ?? lv["oldName"] ?? "";
                const newName = lv.newName ?? lv["newName"] ?? "";
                const idn = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const title = "Name conflict resolved";
                const message = `"${oldName}" → "${newName}" (id: ${id})`;
                const n = { id: idn, title, message, ts: Date.now() };
                setItems((s) => [n, ...s].slice(0, 6));
                setTimeout(() => setItems((s) => s.filter((x) => x.id !== idn)), 6000);
              }

              lastSeen = Math.max(lastSeen, createdAt);
              continue;
            }

            // Feed medium mismatch: notify when open and new
            if (kind === ConflictKind.FeedMediumMismatch) {
              if (status !== "open") continue;
              if (createdAt <= lastSeen) continue;

              const meta = conf.winningValue?.value ?? {};
              const srcOut = meta.srcOut ?? null;
              const tgtIn = meta.tgtIn ?? null;
              const createdBy = conf.createdBy?.value ?? "unknown";

              const idn = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const title = "Feed medium conflict";
              const message = `Feeds relationship conflict (${conf.entityRefs?.values ? Array.from(conf.entityRefs.values()).join(",") : "entities"}) — source:${String(srcOut)} target:${String(tgtIn)} (reported by ${createdBy})`;
              const n = { id: idn, title, message, ts: Date.now() };
              setItems((s) => [n, ...s].slice(0, 6));
              setTimeout(() => setItems((s) => s.filter((x) => x.id !== idn)), 8000);

              lastSeen = Math.max(lastSeen, createdAt);
              continue;
            }

            // Cycle detected in structural (hasPart) relationships
            if (kind === ConflictKind.CycleDetected) {
              if (status !== "open") continue;
              if (createdAt <= lastSeen) continue;

              const createdBy = conf.createdBy?.value ?? "unknown";
              const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];

              // Build signature to dedupe: kind + sorted refs
              const sig = `${kind}:${refs.map(String).sort().join(",")}`;
              const now = Date.now();
              if (notifiedRef.current.has(sig)) {
                lastSeen = Math.max(lastSeen, createdAt);
                continue;
              }
              notifiedRef.current.set(sig, now);
              notifiedRef.current.set(confKey, now);

              const idn = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const title = "Cycle detected (hasPart)";
              const message = `Cycle detected among relationships: ${refs.join(",")} (reported by ${createdBy})`;
              const n = { id: idn, title, message, ts: Date.now() };
              setItems((s) => [n, ...s].slice(0, 6));
              setTimeout(() => setItems((s) => s.filter((x) => x.id !== idn)), 8000);

              lastSeen = Math.max(lastSeen, createdAt);
              continue;
            }
            // Semantically-related attributes (value+unit, width+height, name+description)
            if (kind === ConflictKind.SemanticallyRelatedAttributes) {
              if (status !== "open") continue;

              const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
              // Build signature for dedupe: kind + sorted refs + maybe key
              let keyHint = "";
              try {
                keyHint = conf.winningValue?.value?.key ?? conf.losingValues?.value?.[0]?.key ?? "";
              } catch (e) {}
              const sig = `${kind}:${refs.map(String).sort().join(",")}:${String(keyHint)}`;
              const now2 = Date.now();
              if (notifiedRef.current.has(sig)) {
                lastSeen = Math.max(lastSeen, createdAt);
                continue;
              }
              notifiedRef.current.set(sig, now2);
              notifiedRef.current.set(confKey, now2);

              const idn = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const title = "Semantic attribute conflict";
              const message = `Conflicting attribute values for component(s): ${refs.join(",")} — open for manual resolution`;
              const n = { id: idn, title, message, ts: Date.now() };
              setItems((s) => [n, ...s].slice(0, 6));
              setTimeout(() => setItems((s) => s.filter((x) => x.id !== idn)), 8000);

              lastSeen = Math.max(lastSeen, createdAt);
              continue;
            }
            // Dangling reference: an edge points to a missing component
            if (kind === ConflictKind.DanglingReference) {
              if (status !== "open") continue;
              if (createdAt <= lastSeen) continue;

              const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
              const rels = refs.filter((r) => !!graph.relationships.get(String(r)));

              // Extract missing ids from losingValues if present
              const losing = (conf.losingValues?.value as any) ?? [];
              const missingIds: string[] = [];
              for (const lv of losing) {
                try {
                  if (lv && (lv.missingId || lv.id)) missingIds.push(String(lv.missingId ?? lv.id));
                } catch {}
              }

              // If no relationship remains referencing the missing component,
              // don't notify (the edge was removed locally).
              if (rels.length === 0) {
                lastSeen = Math.max(lastSeen, createdAt);
                continue;
              }

              const intended = conf.winningValue?.value?.intendedDeletionBy ?? conf.createdBy?.value ?? "unknown";

              const sig = `${kind}:${refs.map(String).sort().join(",")}:${String(intended)}:${missingIds.join(",")}`;
              const now3 = Date.now();
              if (notifiedRef.current.has(sig)) {
                lastSeen = Math.max(lastSeen, createdAt);
                continue;
              }
              notifiedRef.current.set(sig, now3);
              notifiedRef.current.set(confKey, now3);

              const idn = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const title = "Dangling reference";
              const message = `Relationship(s) ${rels.join(",")} reference missing component(s) ${missingIds.join(",")} — intended deletion by ${String(intended)}`;
              const n = { id: idn, title, message, ts: Date.now() };
              setItems((s) => [n, ...s].slice(0, 6));
              // Attach conflict metadata so UI can show actions
              try {
                (n as any).conflictId = confId;
                (n as any).kind = kind;
              } catch {}
              setTimeout(() => setItems((s) => s.filter((x) => x.id !== idn)), 10000);

              lastSeen = Math.max(lastSeen, createdAt);
              continue;
            }
            
          } catch {}
        }
      } catch (e) {
        // ignore scanning errors
      }
    };

    // Attach a doc-level update listener to trigger scanning after network/docs changes
    try {
      const onUpdate = () => setTimeout(scanConflicts, 0);
      doc.on?.("Update", onUpdate);
      // initial scan
      scanConflicts();
      return () => doc.off?.("Update", onUpdate);
    } catch (e) {
      // fallback: just scan once
      scanConflicts();
    }
  }, [doc, graph]);

  // Remove notifications when their corresponding conflict becomes resolved.
  useEffect(() => {
    if (!graph) return;

    const computeOpenIdsAndFilter = () => {
      try {
        const openIds = new Set<string>();
        if (typeof graph.conflicts.entries === "function") {
          for (const [k, v] of graph.conflicts.entries()) {
            try {
              if ((v.status?.value ?? "open") === "open") openIds.add(String(k));
            } catch {}
          }
        } else if (typeof graph.conflicts.forEach === "function") {
          graph.conflicts.forEach((v: any, k: any) => {
            try {
              if ((v.status?.value ?? "open") === "open") openIds.add(String(k));
            } catch {}
          });
        }

        setItems((s) => s.filter((it) => !(it.conflictId && !openIds.has(it.conflictId))));
      } catch {}
    };

    if (doc && typeof doc.on === "function") {
      const onUpdate = () => setTimeout(computeOpenIdsAndFilter, 0);
      doc.on("Update", onUpdate);
      // initial run
      computeOpenIdsAndFilter();
      return () => doc.off?.("Update", onUpdate);
    }

    // fallback: run once
    computeOpenIdsAndFilter();
  }, [doc, graph]);

  if (items.length === 0) return null;

  return (
    <div className="ce-notification-center">
      {items.map((it) => (
        <div key={it.id} className="ce-notification">
          <div className="ce-notification-title">{it.title}</div>
          <div className="ce-notification-message">{it.message}</div>
          {it.conflictId && it.kind === String(ConflictKind.DanglingReference) ? (
            <div className="ce-notification-actions">
              <button
                onClick={async () => {
                  try {
                    // keep both: just mark resolved
                    await resolveConflictAction?.(it.conflictId as string, "keepBoth");
                  } catch {}
                  setItems((s) => s.filter((x) => x.id !== it.id));
                }}
              >
                Keep both
              </button>
              <button
                onClick={async () => {
                  try {
                    await resolveConflictAction?.(it.conflictId as string, "deleteBoth");
                  } catch {}
                  setItems((s) => s.filter((x) => x.id !== it.id));
                }}
              >
                Delete both
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default NotificationCenter;
