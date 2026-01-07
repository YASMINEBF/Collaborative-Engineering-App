import  { useEffect, useState } from "react";
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
            if (conf.kind?.value !== ConflictKind.DuplicateName) continue;
            const createdAt = conf.createdAt?.value ?? 0;
            const status = conf.status?.value ?? "open";
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
