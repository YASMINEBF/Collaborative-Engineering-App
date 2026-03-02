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
  keyHint?: string;
  candidates?: any[];
};

export function NotificationCenter() {
  const [items, setItems] = useState<Notification[]>([]);
  const dismissedResolved = useRef<Set<string>>(new Set());
  // Cache for resolved notifications: {conflictId: {notif, shownAt}}
  const resolvedCache = useRef<{[conflictId: string]: {notif: Notification, shownAt: number}}>(Object.create(null));
  const [, forceUpdate] = useState(0);
  const { doc, graph, resolveConflictAction } = useCollab();

  // Track when this session started - only show notifications for conflicts
  // created AFTER this timestamp to avoid showing stale conflicts on app restart
  // Removed unused sessionStartRef
  // Track which resolved conflicts we've shown "resolved by" notification for
  // removed: resolvedNotifiedRef is no longer needed

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
        setItems((s) => [n, ...s].slice(0, 6));
      } else if (d.type === "notify") {
        const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const title = d.title ?? "Notification";
        const message = d.message ?? "";
        const n = { id, title, message, ts: Date.now() };
        setItems((s) => [n, ...s].slice(0, 6));
      }
    }

    window.addEventListener("ce:notification", onEvent as any);
    return () => window.removeEventListener("ce:notification", onEvent as any);
  }, []);

  // Preferred: observe the collab `graph.conflicts` so UI reacts to authoritative CConflict instances
  useEffect(() => {
    if (!graph || !doc) return;

    // Always project notifications from CRDT state
    const projectNotifications = () => {
      const entries: Array<[string, any]> = [];
      try {
        if (typeof graph.conflicts.entries === "function") {
          for (const [k, v] of graph.conflicts.entries()) entries.push([String(k), v]);
        } else if (typeof graph.conflicts.forEach === "function") {
          graph.conflicts.forEach((v: any, k: any) => entries.push([String(k), v]));
        }
      } catch (e) {}

      // Only one notification per conflict, based on latest status
      const notifMap = new Map<string, Notification>();
      const now = Date.now();
      for (const [confId, conf] of entries) {
        // --- Option 1: Reset session dismissal if conflict is re-opened ---
        try {
          const status = conf.status?.value ?? "open";
          if (status === "open" && dismissedResolved.current.has(confId)) {
            dismissedResolved.current.delete(confId);
          }
        } catch {}
        try {
          const kind = conf.kind?.value;
          const createdAt = conf.createdAt?.value ?? 0;
          const status = conf.status?.value ?? "open";
          if (status === "resolved") {
            const resolvedAt = conf.resolvedAt?.value ?? conf.createdAt?.value ?? 0;
            const winningValue = conf.winningValue?.value as any;
            const resolvedBy = winningValue?.resolvedBy ?? conf.resolvedBy?.value ?? "someone";
            let chosenDescription = "";
            if (winningValue?.action === "deleteFeeds") {
              chosenDescription = "deleted feeds relationship";
            } else if (winningValue?.action === "revertMedium") {
              chosenDescription = `set medium to \"${winningValue.chosenValue}\"`;
            } else if (winningValue?.key === "pair:dims" && winningValue?.chosenValue) {
              chosenDescription = `width: ${winningValue.chosenValue.width}, height: ${winningValue.chosenValue.height}`;
            } else if (winningValue?.key === "pair:nameDesc" && winningValue?.chosenValue) {
              chosenDescription = `name: \"${winningValue.chosenValue.name}\", description: \"${winningValue.chosenValue.description}\"`;
            } else if (winningValue?.key === "pair:valueUnit" && winningValue?.chosenValue) {
              chosenDescription = `value: ${winningValue.chosenValue.value}, unit: ${winningValue.chosenValue.unit}`;
            } else if (winningValue?.key?.startsWith("pair:valueUnit") && winningValue?.chosenValue) {
              chosenDescription = `value: ${winningValue.chosenValue.value}, unit: ${winningValue.chosenValue.unit}`;
            } else if (winningValue?.chosenValue !== undefined) {
              chosenDescription = JSON.stringify(winningValue.chosenValue);
            }
            const notif: Notification = {
              id: `notif-resolved-${confId}`,
              title: "✓ Conflict resolved",
              message: `Resolved by ${resolvedBy}${chosenDescription ? `: ${chosenDescription}` : ""}`,
              ts: resolvedAt,
              conflictId: confId,
              kind: String(kind),
            };
            // Store in cache if not already present
            if (!resolvedCache.current[confId]) {
              resolvedCache.current[confId] = { notif, shownAt: now };
            }
            notifMap.set(confId, notif);
          } else if (status === "open") {
            // Only show open notification if not resolved
            if (kind === ConflictKind.DuplicateName) {
              const losing = (conf.losingValues?.value as any) ?? [];
              notifMap.set(confId, {
                id: `notif-${confId}`,
                title: "Name conflict resolved",
                message: losing.length > 0
                  ? `"${losing[0].oldName ?? losing[0]["oldName"] ?? ""}" → "${losing[0].newName ?? losing[0]["newName"] ?? ""}" (id: ${losing[0].id ?? losing[0]["id"] ?? "?"})`
                  : "Duplicate name conflict",
                ts: createdAt,
                conflictId: confId,
                kind: kind,
              });
            } else if (kind === ConflictKind.FeedMediumMismatch) {
              const meta = conf.winningValue?.value ?? {};
              const srcOut = meta.srcOut ?? null;
              const tgtIn = meta.tgtIn ?? null;
              const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
              notifMap.set(confId, {
                id: `notif-${confId}`,
                title: "Feed medium conflict",
                message: `Source outputs "${String(srcOut)}" but target expects "${String(tgtIn)}"`,
                ts: createdAt,
                conflictId: confId,
                kind: kind,
                candidates: [{ srcOut, tgtIn, refs }],
              });
            } else if (kind === ConflictKind.CycleDetected) {
              const createdBy = conf.createdBy?.value ?? "unknown";
              const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
              notifMap.set(confId, {
                id: `notif-${confId}`,
                title: "Cycle detected (hasPart)",
                message: `Cycle detected among relationships: ${refs.join(",")} (reported by ${createdBy})`,
                ts: createdAt,
                conflictId: confId,
                kind: kind,
              });
            } else if (kind === ConflictKind.SemanticallyRelatedAttributes) {
              const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
              let keyHint = "";
              try {
                keyHint = conf.winningValue?.value?.key ?? conf.losingValues?.value?.[0]?.key ?? "";
              } catch (e) {}
              const isSimpleAttr = keyHint.startsWith("attr:");
              const attrName = isSimpleAttr ? keyHint.slice(5) : keyHint;
              const candidates = conf.losingValues?.value ?? [];
              if (isSimpleAttr) {
                notifMap.set(confId, {
                  id: `notif-${confId}`,
                  title: `Concurrent edit: ${attrName}`,
                  message: `Component ${refs.join(", ")}: ` + candidates.map((c: any) => `"${c?.value ?? c}" (${c?.editedBy ?? "?"})`).join(" vs "),
                  ts: createdAt,
                  conflictId: confId,
                  kind: kind,
                  keyHint: keyHint,
                  candidates: candidates,
                });
              } else if (keyHint.startsWith("pair:")) {
                const pairType = keyHint.slice(5);
                let friendlyName = pairType;
                if (pairType === "dims") friendlyName = "Width/Height";
                else if (pairType === "nameDesc") friendlyName = "Name/Description";
                else if (pairType === "valueUnit") friendlyName = "Value/Unit";
                notifMap.set(confId, {
                  id: `notif-${confId}`,
                  title: `Concurrent edit: ${friendlyName}`,
                  message: `Component ${refs.join(", ")} has conflicting ${friendlyName.toLowerCase()} values`,
                  ts: createdAt,
                  conflictId: confId,
                  kind: kind,
                  keyHint: keyHint,
                  candidates: candidates,
                });
              } else {
                notifMap.set(confId, {
                  id: `notif-${confId}`,
                  title: "Semantic attribute conflict",
                  message: `Conflicting attribute values for component(s): ${refs.join(",")} — open for manual resolution`,
                  ts: createdAt,
                  conflictId: confId,
                  kind: kind,
                });
              }
            } else if (kind === ConflictKind.ConcurrentAttributeEdit) {
              const winning = conf.winningValue?.value ?? {};
              const losing = conf.losingValues?.value ?? [];
              const compName = winning.componentName ?? winning.componentId ?? "?";
              const attrName = winning.attributeName ?? "attribute";
              const allValues = [
                { value: winning.value, editedBy: winning.editedBy },
                ...losing.map((l: any) => ({ value: l.value, editedBy: l.editedBy })),
              ];
              notifMap.set(confId, {
                id: `notif-${confId}`,
                title: "Concurrent attribute edit",
                message: `${compName}.${attrName} was edited concurrently: ` + allValues.map((v: any) => `"${v.value}" (${v.editedBy})`).join(" vs "),
                ts: createdAt,
                conflictId: confId,
                kind: kind,
                candidates: allValues,
              });
            } else if (kind === ConflictKind.DanglingReference) {
              const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
              const rels = refs.filter((r) => !!graph.relationships.get(String(r)));
              const losing = (conf.losingValues?.value as any) ?? [];
              const missingIds: string[] = [];
              for (const lv of losing) {
                try {
                  if (lv && (lv.missingId || lv.id)) missingIds.push(String(lv.missingId ?? lv.id));
                } catch {}
              }
              // Only one notification per conflictId
              const intended = conf.winningValue?.value?.intendedDeletionBy ?? conf.createdBy?.value ?? "unknown";
              notifMap.set(confId, {
                id: `notif-${confId}`,
                title: "Dangling reference",
                message: `Relationship(s) ${rels.join(",")} reference missing component(s) ${missingIds.join(",")} — intended deletion by ${String(intended)}`,
                ts: createdAt,
                conflictId: confId,
                kind: kind,
              });
            } else if (kind === ConflictKind.InvalidFeedCardinality) {
              const meta = conf.winningValue?.value ?? {} as any;
              const competingEdges: string[] = meta.competingEdges ?? (conf.losingValues?.value as any) ?? [];
              const portId = meta.portId ?? (meta.key ?? "").split("::")[0];
              const medium = (meta.key ?? "").split("::")[1] ?? "unknown";
              notifMap.set(confId, {
                id: `notif-${confId}`,
                title: "Port cardinality conflict",
                message: `Port "${portId}" has ${competingEdges.length} concurrent feeds edges for medium "${medium}" — choose which to keep`,
                ts: createdAt,
                conflictId: confId,
                kind: kind,
                candidates: competingEdges.map((eid: string) => ({ edgeId: eid })),
              });
            }
          }
        } catch {}
      }
      // Add any cached resolved notifications that should still be visible
      for (const [confId, { notif, shownAt }] of Object.entries(resolvedCache.current)) {
        // If not in notifMap (i.e., not in CRDT anymore), but still within 4s, show it
        if (!notifMap.has(confId) && Date.now() - shownAt < 4000) {
          notifMap.set(confId, notif);
        }
        // If expired, remove from cache
        if (!notifMap.has(confId) && Date.now() - shownAt >= 4000) {
          delete resolvedCache.current[confId];
        }
      }
      // Filter out resolved notifications and resolved ConcurrentAttributeEdit conflicts that have been dismissed in this session
      const filtered = Array.from(notifMap.values()).filter((notif) => {
        // If dismissed, suppress ALL notifications for this conflictId
        if (dismissedResolved.current.has(notif.conflictId || '')) return false;
        return true;
      });
      setItems(filtered);
    };

    projectNotifications();

    if (doc && typeof doc.on === "function") {
      const onUpdate = () => {
        projectNotifications();
        forceUpdate((n) => n + 1);
      };
      doc.on("Update", onUpdate);
      return () => doc.off("Update", onUpdate);
    }
  }, [doc, graph]);

  // Remove notifications when their corresponding conflict becomes resolved.
  useEffect(() => {
    if (!graph) return;

    const computeOpenIdsAndFilter = () => {
      // No longer filtering resolved conflicts - they stay in items and render differently
      // This function is kept for potential future filtering needs
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

  // Helper to check if a conflict is resolved and get resolution info
  const getConflictResolution = (conflictId: string): { resolved: boolean; resolvedBy: string; chosenValue: any; keyHint: string } | null => {
    if (!graph) return null;
    try {
      const conflict = graph.conflicts.get(conflictId);
      if (!conflict) return null;
      const status = conflict.status?.value;
      if (status !== "resolved") return null;
      
      const winningValue = conflict.winningValue?.value as any;
      const resolvedBy = winningValue?.resolvedBy ?? conflict.resolvedBy?.value ?? "someone";
      const chosenValue = winningValue?.chosenValue ?? winningValue;
      const keyHint = winningValue?.key ?? "";
      
      return { resolved: true, resolvedBy, chosenValue, keyHint };
    } catch {
      return null;
    }
  };

  // Helper to format chosen value for display
  const formatChosenValue = (chosenValue: any, keyHint: string): string => {
    if (!chosenValue) return "";
    try {
      if (keyHint === "pair:dims") {
        return `width: ${chosenValue.width}, height: ${chosenValue.height}`;
      } else if (keyHint === "pair:nameDesc") {
        return `name: "${chosenValue.name}", description: "${chosenValue.description}"`;
      } else if (keyHint === "pair:valueUnit") {
        return `value: ${chosenValue.value}, unit: ${chosenValue.unit}`;
      } else if (keyHint.startsWith("pair:valueUnit")) {
        return `value: ${chosenValue.value}, unit: ${chosenValue.unit}`;
      } else if (chosenValue.action === "deleteFeeds") {
        return "deleted feeds relationship";
      } else if (chosenValue.action === "revertMedium") {
        return `set medium to "${chosenValue.chosenValue}"`;
      } else if (chosenValue.value !== undefined) {
        return `"${chosenValue.value}"`;
      } else if (typeof chosenValue === "string" || typeof chosenValue === "number") {
        return `"${chosenValue}"`;
      }
      return JSON.stringify(chosenValue);
    } catch {
      return String(chosenValue);
    }
  };

  // Helper to get conflict values for ConcurrentAttributeEdit
  const getConflictValues = (conflictId: string): Array<{ value: any; editedBy: string }> => {
    if (!graph) return [];
    try {
      const conflict = graph.conflicts.get(conflictId);
      if (!conflict) return [];
      const winning = conflict.winningValue?.value as any;
      const losing = (conflict.losingValues?.value ?? []) as any[];
      const values = [];
      if (winning?.value !== undefined) {
        values.push({ value: winning.value, editedBy: winning.editedBy ?? "unknown" });
      }
      for (const l of losing) {
        if (l?.value !== undefined) {
          values.push({ value: l.value, editedBy: l.editedBy ?? "unknown" });
        }
      }
      return values;
    } catch {
      return [];
    }
  };

  return (
    <div className="ce-notification-center">
      {items.map((it) => {
        // Check if this conflict has been resolved
        const resolution = it.conflictId ? getConflictResolution(it.conflictId) : null;
        
        if (resolution?.resolved || (it.kind === String(ConflictKind.ConcurrentAttributeEdit) && graph?.conflicts.get(it.conflictId)?.status?.value === 'resolved')) {
          // Show resolved state instead of original content
          const conflict = graph?.conflicts.get(it.conflictId);
          const winningValue = conflict?.winningValue?.value;
          const resolvedBy = winningValue?.resolvedBy ?? conflict?.resolvedBy?.value ?? "someone";
          const chosenValue = winningValue?.chosenValue ?? winningValue;
          const keyHint = winningValue?.key ?? "";
          return (
            <div key={it.id} className="ce-notification ce-notification-resolved">
              <button
                className="ce-notification-dismiss"
                onClick={() => {
                  if (it.conflictId) dismissedResolved.current.add(it.conflictId);
                  setItems((s) => s.filter((x) => x.id !== it.id));
                }}
                title="Dismiss"
              >
                ×
              </button>
              <div className="ce-notification-title">✓ Resolved</div>
              <div className="ce-notification-message">
                This issue has been resolved by <strong>{resolvedBy}</strong>
                {chosenValue && (
                  <span className="ce-resolution-value">
                    <br />Chosen: {formatChosenValue(chosenValue, keyHint || it.keyHint || "")}
                  </span>
                )}
              </div>
            </div>
          );
        }
        
        // Show original notification with options
        return (
        <div key={it.id} className="ce-notification">
          <button
            className="ce-notification-dismiss"
            onClick={() => setItems((s) => s.filter((x) => x.id !== it.id))}
            title="Dismiss"
          >
            ×
          </button>
          <div className="ce-notification-title">{it.title}</div>
          <div className="ce-notification-message">{it.message}</div>
          {it.conflictId && it.kind === String(ConflictKind.DanglingReference) ? (
            <div className="ce-notification-actions">
              <button
                onClick={async () => {
                  try {
                    // keep both: just mark resolved
                    const ok = await resolveConflictAction?.(it.conflictId as string, "keepBoth");
                    if (!ok) return;
                    // remove notif only on success
                    setItems((s) => s.filter((x) => x.id !== it.id));
                  } catch (e) {
                    // keep the notification visible on failure
                    // eslint-disable-next-line no-console
                    console.warn("resolveConflictAction keepBoth failed:", e);
                  }
                }}
              >
                Keep both
              </button>
              <button
                onClick={async () => {
                  try {
                    const ok = await resolveConflictAction?.(it.conflictId as string, "deleteBoth");
                    if (!ok) return;
                    setItems((s) => s.filter((x) => x.id !== it.id));
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn("resolveConflictAction deleteBoth failed:", e);
                  }
                }}
              >
                Delete both
              </button>
            </div>
          ) : null}
          {/* Port Cardinality Conflict - choose which edge to keep */}
          {it.conflictId && it.kind === String(ConflictKind.InvalidFeedCardinality) && it.candidates && it.candidates.length > 0 ? (
            <div className="ce-notification-actions ce-attr-conflict-actions">
              {it.candidates.map((c: any, idx: number) => (
                <button
                  key={idx}
                  className="ce-attr-choice-btn"
                  onClick={async () => {
                    try {
                      const ok = await resolveConflictAction?.(it.conflictId as string, `deleteOneEdge:${c.edgeId}`);
                      if (!ok) return;
                      setItems((s) => s.filter((x) => x.id !== it.id));
                    } catch (e) {
                      console.warn("resolveConflictAction deleteOneEdge failed:", e);
                    }
                  }}
                >
                  Keep edge {idx + 1} (delete others)
                </button>
              ))}
            </div>
          ) : null}
          {/* Feed Medium Mismatch - two options: delete feeds or revert medium */}
          {it.conflictId && it.kind === String(ConflictKind.FeedMediumMismatch) && it.candidates?.[0] ? (
            <div className="ce-notification-actions ce-attr-conflict-actions">
              <button
                className="ce-attr-choice-btn"
                onClick={async () => {
                  try {
                    const ok = await resolveConflictAction?.(it.conflictId as string, "deleteFeeds");
                    if (!ok) return;
                    setItems((s) => s.filter((x) => x.id !== it.id));
                  } catch (e) {
                    console.warn("resolveConflictAction deleteFeeds failed:", e);
                  }
                }}
              >
                Delete feeds relationship
              </button>
              <button
                className="ce-attr-choice-btn"
                onClick={async () => {
                  try {
                    // revertMedium: set source outputMedium = target inputMedium
                    const ok = await resolveConflictAction?.(it.conflictId as string, `revertMedium:useTarget`);
                    if (!ok) return;
                    setItems((s) => s.filter((x) => x.id !== it.id));
                  } catch (e) {
                    console.warn("resolveConflictAction revertMedium failed:", e);
                  }
                }}
              >
                Set source to "{it.candidates[0].tgtIn}"
              </button>
              <button
                className="ce-attr-choice-btn"
                onClick={async () => {
                  try {
                    // revertMedium: set target inputMedium = source outputMedium
                    const ok = await resolveConflictAction?.(it.conflictId as string, `revertMedium:useSource`);
                    if (!ok) return;
                    setItems((s) => s.filter((x) => x.id !== it.id));
                  } catch (e) {
                    console.warn("resolveConflictAction revertMedium failed:", e);
                  }
                }}
              >
                Set target to "{it.candidates[0].srcOut}"
              </button>
            </div>
          ) : null}
          {it.conflictId && it.kind === String(ConflictKind.ConcurrentAttributeEdit) ? (
            <div className="ce-notification-actions ce-attr-conflict-actions">
              {getConflictValues(it.conflictId).map((cv, idx) => (
                <button
                  key={idx}
                  className="ce-attr-choice-btn"
                  title={`Choose "${cv.value}" (edited by ${cv.editedBy})`}
                  onClick={async () => {
                    try {
                      const ok = await resolveConflictAction?.(
                        it.conflictId as string, 
                        `chooseValue:${JSON.stringify(cv.value)}`
                      );
                      if (!ok) return;
                      if (it.conflictId) dismissedResolved.current.add(it.conflictId);
                      setItems((s) => s.filter((x) => x.id !== it.id));
                    } catch (e) {
                      // eslint-disable-next-line no-console
                      console.warn("resolveConflictAction chooseValue failed:", e);
                    }
                  }}
                >
                  Use "{String(cv.value)}"
                  <span className="ce-attr-editor">({cv.editedBy})</span>
                </button>
              ))}
            </div>
          ) : null}
          {/* Simple attribute conflicts (attr:*) from SemanticallyRelatedAttributes */}
          {it.conflictId && it.kind === String(ConflictKind.SemanticallyRelatedAttributes) && it.keyHint?.startsWith("attr:") && it.candidates ? (
            <div className="ce-notification-actions ce-attr-conflict-actions">
              {it.candidates.map((cv: any, idx: number) => (
                <button
                  key={idx}
                  className="ce-attr-choice-btn"
                  title={`Choose "${cv?.value ?? cv}" (edited by ${cv?.editedBy ?? "?"})`}
                  onClick={async () => {
                    try {
                      // Use resolveMVRegister to apply the chosen value
                      const ok = await resolveConflictAction?.(
                        it.conflictId as string, 
                        `chooseAttrValue:${it.keyHint}:${JSON.stringify(cv)}`
                      );
                      if (!ok) return;
                      setItems((s) => s.filter((x) => x.id !== it.id));
                    } catch (e) {
                      // eslint-disable-next-line no-console
                      console.warn("resolveConflictAction chooseAttrValue failed:", e);
                    }
                  }}
                >
                  Use "{String(cv?.value ?? cv)}"
                  {cv?.editedBy && <span className="ce-attr-editor">({cv.editedBy})</span>}
                </button>
              ))}
            </div>
          ) : null}
          {/* Semantic pair conflicts (pair:dims, pair:nameDesc, pair:valueUnit) */}
          {it.conflictId && it.kind === String(ConflictKind.SemanticallyRelatedAttributes) && it.keyHint?.startsWith("pair:") && it.candidates && it.candidates.length >= 2 ? (
            <div className="ce-notification-actions ce-attr-conflict-actions">
              {(() => {
                const pairType = it.keyHint?.slice(5); // "dims", "nameDesc", "valueUnit"
                const c0 = it.candidates[0];
                const c1 = it.candidates[1];
                
                if (pairType === "dims") {
                  // ...existing code...
                  const allOptions = [
                    { label: `W: ${c0?.width}, H: ${c0?.height}`, value: { width: c0?.width, height: c0?.height, unit: c0?.unit ?? c1?.unit } },
                    { label: `W: ${c1?.width}, H: ${c1?.height}`, value: { width: c1?.width, height: c1?.height, unit: c0?.unit ?? c1?.unit } },
                    { label: `W: ${c0?.width}, H: ${c1?.height}`, value: { width: c0?.width, height: c1?.height, unit: c0?.unit ?? c1?.unit } },
                    { label: `W: ${c1?.width}, H: ${c0?.height}`, value: { width: c1?.width, height: c0?.height, unit: c0?.unit ?? c1?.unit } },
                  ];
                  return allOptions.map((opt, idx) => (
                    <button
                      key={idx}
                      className="ce-attr-choice-btn"
                      onClick={async () => {
                        try {
                          const ok = await resolveConflictAction?.(it.conflictId as string, `choosePairValue:${it.keyHint}:${JSON.stringify(opt.value)}`);
                          if (!ok) return;
                          setItems((s) => s.filter((x) => x.id !== it.id));
                        } catch (e) {
                          console.warn("resolveConflictAction choosePairValue failed:", e);
                        }
                      }}
                    >
                      {opt.label}
                    </button>
                  ));
                }
                
                if (pairType === "nameDesc") {
                  // ...existing code...
                  const allOptions = [
                    { label: `Name: "${c0?.name}", Desc: "${c0?.description}"`, value: { name: c0?.name, description: c0?.description } },
                    { label: `Name: "${c1?.name}", Desc: "${c1?.description}"`, value: { name: c1?.name, description: c1?.description } },
                    { label: `Name: "${c0?.name}", Desc: "${c1?.description}"`, value: { name: c0?.name, description: c1?.description } },
                    { label: `Name: "${c1?.name}", Desc: "${c0?.description}"`, value: { name: c1?.name, description: c0?.description } },
                  ];
                  return allOptions.map((opt, idx) => (
                    <button
                      key={idx}
                      className="ce-attr-choice-btn"
                      onClick={async () => {
                        try {
                          const ok = await resolveConflictAction?.(it.conflictId as string, `choosePairValue:${it.keyHint}:${JSON.stringify(opt.value)}`);
                          if (!ok) return;
                          setItems((s) => s.filter((x) => x.id !== it.id));
                        } catch (e) {
                          console.warn("resolveConflictAction choosePairValue failed:", e);
                        }
                      }}
                    >
                      {opt.label}
                    </button>
                  ));
                }
                
                // Support all valueUnit conflicts (e.g., pair:valueUnit:width, pair:valueUnit:height)
                if (pairType.startsWith("valueUnit")) {
                  return [
                    <button
                      key="keep-value"
                      className="ce-attr-choice-btn"
                      onClick={async () => {
                        try {
                          const ok = await resolveConflictAction?.(it.conflictId as string, `choosePairValue:${it.keyHint}:${JSON.stringify({ value: c0?.value, unit: c1?.unit })}`);
                          if (!ok) return;
                          setItems((s) => s.filter((x) => x.id !== it.id));
                        } catch (e) {
                          console.warn("resolveConflictAction choosePairValue failed:", e);
                        }
                      }}
                    >
                      Keep value: {c0?.value}
                    </button>,
                    <button
                      key="keep-unit"
                      className="ce-attr-choice-btn"
                      onClick={async () => {
                        try {
                          const ok = await resolveConflictAction?.(it.conflictId as string, `choosePairValue:${it.keyHint}:${JSON.stringify({ value: c1?.value, unit: c0?.unit })}`);
                          if (!ok) return;
                          setItems((s) => s.filter((x) => x.id !== it.id));
                        } catch (e) {
                          console.warn("resolveConflictAction choosePairValue failed:", e);
                        }
                      }}
                    >
                      Keep unit: {c0?.unit}
                    </button>,
                    <button
                      key="keep-both"
                      className="ce-attr-choice-btn"
                      onClick={async () => {
                        try {
                          const ok = await resolveConflictAction?.(it.conflictId as string, `choosePairValue:${it.keyHint}:${JSON.stringify({ value: c0?.value, unit: c0?.unit })}`);
                          if (!ok) return;
                          setItems((s) => s.filter((x) => x.id !== it.id));
                        } catch (e) {
                          console.warn("resolveConflictAction choosePairValue failed:", e);
                        }
                      }}
                    >
                      Keep both: {c0?.value}, {c0?.unit}
                    </button>,
                    <button
                      key="keep-neither"
                      className="ce-attr-choice-btn"
                      onClick={async () => {
                        try {
                          const ok = await resolveConflictAction?.(it.conflictId as string, `choosePairValue:${it.keyHint}:${JSON.stringify({ value: c1?.value, unit: c1?.unit })}`);
                          if (!ok) return;
                          setItems((s) => s.filter((x) => x.id !== it.id));
                        } catch (e) {
                          console.warn("resolveConflictAction choosePairValue failed:", e);
                        }
                      }}
                    >
                      Keep neither: {c1?.value}, {c1?.unit}
                    </button>
                  ];
                }
                
                return null;
              })()}
            </div>
          ) : null}
        </div>
        );
      })}
    </div>
  );
}

export default NotificationCenter;
