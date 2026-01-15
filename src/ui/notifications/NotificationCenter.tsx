import { useEffect, useState } from "react";
import "./notification.css";
import { useCollab } from "../../collabs/provider/CollabProvider";
import { ConflictKind } from "../../collabs/model/enums/ConflictEnum";

type Notification = {
  id: string;
  title?: string;
  message: string;
  ts: number;
};

export function NotificationCenter() {
  const [items, setItems] = useState<Notification[]>([]);
  const { doc, graph } = useCollab();

  // Listen for window-dispatched events (fallback / other UI code)
  useEffect(() => {
    function onEvent(e: any) {
      const d = e.detail;
      if (!d) return;
      // Support different notification event shapes. Existing callers emit
      // `{ type: 'rename', oldName, newName, affectedId }`. We also accept
      // `{ type: 'notify', title, message }` for arbitrary UI notifications.
      if (d.type === "rename") {
        const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const title = "Name conflict resolved";
        const message = `"${d.oldName}" → "${d.newName}" (id: ${d.affectedId})`;
        const n = { id, title, message, ts: Date.now() };
        setItems((s) => [n, ...s].slice(0, 6));

        // Auto-remove after 6s
        setTimeout(() => {
          setItems((s) => s.filter((x) => x.id !== id));
        }, 6000);
      } else if (d.type === "notify") {
        const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const title = d.title ?? "Notification";
        const message = d.message ?? "";
        const n = { id, title, message, ts: Date.now() };
        setItems((s) => [n, ...s].slice(0, 6));

        setTimeout(() => {
          setItems((s) => s.filter((x) => x.id !== id));
        }, 6000);
      }
    }

    window.addEventListener("ce:notification", onEvent as any);
    return () => window.removeEventListener("ce:notification", onEvent as any);
  }, []);

  // Preferred: observe the collab `graph.conflicts` so UI reacts to authoritative CConflict instances
  useEffect(() => {
    if (!graph || !doc) return;

    let lastSeen = Date.now() - 1000;

    // Helper to scan existing conflicts for recent resolved duplicate-name entries
    const scanConflicts = () => {
      try {
        for (const conf of graph.conflicts.values()) {
          try {
            const kind = conf.kind?.value;
            const createdAt = conf.createdAt?.value ?? 0;
            const status = conf.status?.value ?? "open";

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
              const idn = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const title = "Cycle detected (hasPart)";
              const message = `Cycle detected among relationships: ${refs.join(",")} (reported by ${createdBy})`;
              const n = { id: idn, title, message, ts: Date.now() };
              setItems((s) => [n, ...s].slice(0, 6));
              setTimeout(() => setItems((s) => s.filter((x) => x.id !== idn)), 8000);

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

  if (items.length === 0) return null;

  return (
    <div className="ce-notification-center">
      {items.map((it) => (
        <div key={it.id} className="ce-notification">
          <div className="ce-notification-title">{it.title}</div>
          <div className="ce-notification-message">{it.message}</div>
        </div>
      ))}
    </div>
  );
}

export default NotificationCenter;
