// src/collabs/provider/CollabProvider.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { createLocalDoc } from "./docSetup";
import startConflictResolver from "../semantics/conflictResolver";
import { applyMVRegisterResolution } from "../semantics/resolveMVRegisterConflicts";
import { exposeTestApi } from "../../testing/exposeTestApi";

export type CollabStatus = "loading" | "ready" | "error";

export type CollabContextType = {
  status: CollabStatus;
  doc: any | null;
  graph: any | null;
  error?: unknown;

  // Exposed control object for connecting/disconnecting the network
  provider?: {
    connect: () => void;
    disconnect: () => void;
    network?: any;
  } | null;

  // Network connection state
  isConnected?: boolean;

  userId?: string;

  // MV helpers for UI: list candidates and apply resolution
  getMVRegisterCandidates?: (compId: string, key?: string) => any[];
  resolveMVRegister?: (compId: string, chosenValue: any) => boolean;
  // Resolve conflicts by user action: e.g. 'keepBoth' or 'deleteBoth'
  resolveConflictAction?: (conflictId: string, action: string) => Promise<boolean>;
};

const CollabContext = createContext<CollabContextType>({
  status: "loading",
  doc: null,
  graph: null,
});

export function useCollab() {
  return useContext(CollabContext);
}

function isE2EEnabled(): boolean {
  try {
    const mode = (import.meta as any).env?.MODE;
    if (mode === "production") return false;

    // Vite renderer env (preferred)
    const viteFlag = (import.meta as any).env?.VITE_E2E === "1";

    // Some setups (Electron) can still have process.env available
    const procFlag = (globalThis as any)?.process?.env?.VITE_E2E === "1";

    // Optional manual flag (you can set it in preload if you want)
    const pwFlag = (globalThis as any).__PLAYWRIGHT__ === true;

    return !!(viteFlag || procFlag || pwFlag);
  } catch {
    return false;
  }
}

export const CollabProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<CollabContextType>({
    status: "loading",
    doc: null,
    graph: null,
    provider: null,
    isConnected: false,
    userId: undefined,
  });

  const networkRef = useRef<any>(null);
  const connectedRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const resolverRef = { stop: undefined as undefined | (() => void) };
    // If E2E/testing is enabled, expose a minimal test API stub early so
    // Playwright can detect presence quickly while the full graph/doc are
    // still initializing. The real API will replace this stub once ready.
    try {
      if (isE2EEnabled()) {
        const w = window as any;
        if (!w.__CE_TEST_API__) {
          w.__CE_TEST_API__ = { ready: false };
        }
      }
    } catch {}

    createLocalDoc()
      .then((setup) => {
        if (cancelled) return;

        networkRef.current = (setup as any).network ?? null;

        // connection flag
        connectedRef.current = false;

        // Attach connect/disconnect handlers
        try {
          networkRef.current?.on?.("Connect", () => {
            connectedRef.current = true;
            setState((s) => ({ ...s, isConnected: true }));
          });
          networkRef.current?.on?.("Disconnect", () => {
            connectedRef.current = false;
            setState((s) => ({ ...s, isConnected: false }));
          });
        } catch {
          // ignore
        }

        const providerObj = {
          connect: () => networkRef.current?.connect?.(),
          disconnect: () => networkRef.current?.disconnect?.(),
          network: networkRef.current,
        };

        // Determine a persistent local user id (stored in localStorage if available).
        let localUserId: string | undefined;
        try {
          const key = "ce_localUserId";
          localUserId = localStorage.getItem(key) ?? undefined;
          if (!localUserId) {
            localUserId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            localStorage.setItem(key, localUserId);
          }
        } catch {
          localUserId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }

        // MV helper wrappers capture the current graph and localUserId
        const getMVRegisterCandidates = (compId: string, key?: string) => {
          try {
            const g = (setup as any).graph;
            const comp = g?.components?.get?.(compId);
            if (!comp) return [];
            const dimsMap = (comp as any)?.dimensions;
            if (!dimsMap || typeof dimsMap.getConflicts !== "function") return [];
            const k = key ?? ((comp as any).dimsKey ? (comp as any).dimsKey() : "_dims");
            return dimsMap.getConflicts(k) ?? [];
          } catch {
            return [];
          }
        };

        const resolveMVRegister = (compId: string, chosenValue: any) => {
          try {
            const g = (setup as any).graph;
            return applyMVRegisterResolution(g, compId, chosenValue, localUserId ?? "system");
          } catch {
            return false;
          }
        };

        // Resolve conflict action: delete both entities or keep both and mark resolved
        const resolveConflictAction = async (conflictId: string, action: string) => {
          try {
            try {
              // eslint-disable-next-line no-console
              console.debug("CollabProvider.resolveConflictAction: called", { conflictId, action });
            } catch {}
            const g = (setup as any).graph as any;
            if (!g || !g.conflicts) return false;
            const c = g.conflicts.get(conflictId);
            if (!c) return false;

            const refs: string[] = [];
            try {
              const iter = c.entityRefs?.values ? c.entityRefs.values() : [];
              for (const v of iter) refs.push(String(v));
            } catch {}
            
            // eslint-disable-next-line no-console
            console.log("%c[resolveConflictAction] START", "color: red; font-weight: bold; font-size: 14px", {
              conflictId,
              action,
              refs,
            });

            const { deleteRelationship } = await import("../commands/relationships");
            const { deleteComponent } = await import("../commands/components");

            const runtime: any = (g as any).runtime ?? (g as any).doc ?? null;

            const doWork = () => {
              try {
                if (action === "deleteBoth") {
                  for (const id of refs) {
                    try {
                      if (g.relationships && typeof g.relationships.get === "function" && g.relationships.get(id)) {
                        deleteRelationship(g, id as any);
                      }
                    } catch {}
                  }
                  for (const id of refs) {
                    try {
                      if (g.components && typeof g.components.get === "function" && g.components.get(id)) {
                        deleteComponent(g, id as any, localUserId ?? "user");
                      }
                    } catch {}
                  }
                } else if (action === "keepBoth") {
                  // Recreate missing components and relationships from deletion logs,
                  // AND clear tombstone flags on components that were resurrected by
                  // the resolver (they exist in the map but still have isDeleted=true).
                  try {
                    for (const id of refs) {
                      try {
                        const comp = g.components && typeof g.components.get === "function"
                          ? g.components.get(id)
                          : undefined;

                        if (!comp) {
                          // Component is fully missing — recreate from deletionLog
                          try {
                            const rec = g.deletionLog?.get?.(String(id));
                            if (rec) {
                              try {
                                g.components.set(String(id), rec.type ?? "equipment", rec.uniqueName ?? String(id));
                                const c = g.components.get(String(id));
                                if (c) {
                                  try { if (c.position && rec.position) c.position.value = rec.position; } catch {}
                                  try { if (c.isDeleted) c.isDeleted.value = false; } catch {}
                                  try { if (c.deletedAt) c.deletedAt.value = null; } catch {}
                                  try { if (c.deletedBy) c.deletedBy.value = null; } catch {}
                                }
                              } catch {}
                            }
                          } catch {}
                        } else {
                          // Component exists — but it may be a tombstone left by
                          // ensureTombstoneComponent.  Clear the flags unconditionally
                          // so "Keep Node" actually un-deletes it.
                          try { if (comp.isDeleted && comp.isDeleted.value === true) comp.isDeleted.value = false; } catch {}
                          try { if (comp.deletedAt && comp.deletedAt.value != null) comp.deletedAt.value = null; } catch {}
                          try { if (comp.deletedBy && comp.deletedBy.value != null) comp.deletedBy.value = null; } catch {}
                        }
                      } catch {}
                    }

                    // Restore relationships from relationshipDeletionLog if missing.
                    // Also restore any incident edges of resurrected nodes that are
                    // still sitting in the log but were not included in refs
                    // (belt-and-suspenders: the resolver should have added them, but
                    // we scan here too so resolution is self-healing).
                    const restoredNodeIds = new Set<string>();
                    for (const id of refs) {
                      try {
                        if (g.components && typeof g.components.get === "function" && g.components.get(id)) {
                          restoredNodeIds.add(String(id));
                        }
                      } catch {}
                    }

                    // Collect ALL relationship IDs we need to ensure exist:
                    // (a) every ID already in refs, plus
                    // (b) every ID in relationshipDeletionLog whose source or target
                    //     is one of the restored nodes, plus
                    // (c) every ID from deletionLog.relationshipsJson embedded snapshots
                    const relIdsToRestore = new Set<string>(refs);
                    
                    // eslint-disable-next-line no-console
                    console.log("%c[keepBoth] restoredNodeIds:", "color: magenta; font-weight: bold", Array.from(restoredNodeIds));
                    
                    // First, gather from deletionLog.relationshipsJson (embedded snapshots stored as JSON string)
                    // This is the primary source — deleteComponent records incident edges here
                    const embeddedSnapshots = new Map<string, any>();
                    try {
                      for (const nodeId of restoredNodeIds) {
                        try {
                          const rec: any = g.deletionLog?.get?.(String(nodeId));
                          // Parse the JSON string back to array
                          let relationships: any[] = [];
                          if (rec?.relationshipsJson && typeof rec.relationshipsJson === "string") {
                            try {
                              relationships = JSON.parse(rec.relationshipsJson);
                            } catch {}
                          } else if (rec?.relationships && Array.isArray(rec.relationships)) {
                            // Fallback for old format
                            relationships = rec.relationships;
                          }
                          
                          if (relationships.length > 0) {
                            // eslint-disable-next-line no-console
                            console.log(`%c[keepBoth] deletionLog[${nodeId}].relationships:`, "color: cyan", relationships);
                            for (const snap of relationships) {
                              if (snap?.id) {
                                embeddedSnapshots.set(String(snap.id), snap);
                                relIdsToRestore.add(String(snap.id));
                              }
                            }
                          }
                        } catch {}
                      }
                    } catch {}
                    
                    // eslint-disable-next-line no-console
                    console.log("%c[keepBoth] embeddedSnapshots from deletionLog:", "color: cyan; font-weight: bold", 
                      Array.from(embeddedSnapshots.keys()));
                    
                    // Second, also check relationshipDeletionLog (written by deleteRelationship)
                    try {
                      if (g.relationshipDeletionLog) {
                        const logEntries: Array<[string, any]> = [];
                        try {
                          if (typeof g.relationshipDeletionLog.entries === "function") {
                            for (const [k, v] of g.relationshipDeletionLog.entries()) logEntries.push([String(k), v]);
                          } else if (typeof g.relationshipDeletionLog.forEach === "function") {
                            g.relationshipDeletionLog.forEach((v: any, k: any) => logEntries.push([String(k), v]));
                          }
                        } catch {}
                        // eslint-disable-next-line no-console
                        console.log("%c[keepBoth] relationshipDeletionLog entries:", "color: orange", logEntries);
                        for (const [k, rec] of logEntries) {
                          try {
                            if (restoredNodeIds.has(String(rec.sourceId)) || restoredNodeIds.has(String(rec.targetId))) {
                              relIdsToRestore.add(String(k));
                            }
                          } catch {}
                        }
                      }
                    } catch {}
                    
                    // eslint-disable-next-line no-console
                    console.log("%c[keepBoth] final relIdsToRestore:", "color: lime; font-weight: bold", Array.from(relIdsToRestore));

                    for (const id of relIdsToRestore) {
                      try {
                        if (g.relationships && typeof g.relationships.get === "function" && !g.relationships.get(id)) {
                          // Try relationshipDeletionLog first, then fall back to embeddedSnapshots
                          let rrec = g.relationshipDeletionLog?.get?.(String(id)) ?? null;
                          if (!rrec && embeddedSnapshots.has(String(id))) {
                            rrec = embeddedSnapshots.get(String(id));
                            // eslint-disable-next-line no-console
                            console.log(`%c[keepBoth] Using embedded snapshot for ${id}:`, "color: yellow", rrec);
                          }
                          
                          if (rrec) {
                            // eslint-disable-next-line no-console
                            console.log(`%c[keepBoth] Restoring relationship ${id}:`, "color: green", rrec);
                            try {
                              g.relationships.set(
                                String(id),
                                rrec.type ?? "relationship",
                                rrec.kind ?? rrec.kind,
                                rrec.sourceId,
                                rrec.targetId,
                                rrec.medium ?? null,
                                rrec.sourceHandle ?? null,
                                rrec.targetHandle ?? null
                              );
                              const rel = g.relationships.get(String(id));
                              try { if (rel?.createdAt && rel.createdAt.value === 0) rel.createdAt.value = rrec.deletedAt ?? Date.now(); } catch {}
                              try { if (rel?.createdBy && !rel.createdBy.value) rel.createdBy.value = rrec.deletedBy ?? ""; } catch {}
                            } catch (restoreErr) {
                              // eslint-disable-next-line no-console
                              console.error(`[keepBoth] Failed to restore relationship ${id}:`, restoreErr);
                            }
                          } else {
                            // eslint-disable-next-line no-console
                            console.warn(`%c[keepBoth] No snapshot found for relationship ${id}`, "color: red");
                          }
                        }
                      } catch {}
                    }
                  } catch {}
                }
                
                // Handle chooseValue action for ConcurrentAttributeEdit conflicts
                if (action.startsWith("chooseValue:")) {
                  try {
                    const chosenValueJson = action.slice("chooseValue:".length);
                    const chosenValue = JSON.parse(chosenValueJson);
                    
                    // Get the component and attribute info from the conflict
                    const winning = c.winningValue?.value as any;
                    if (winning?.componentId && winning?.attributeName) {
                      const comp = g.components?.get?.(winning.componentId);
                      if (comp) {
                        const attr = (comp as any)[winning.attributeName];
                        if (attr && typeof attr === "object" && "value" in attr) {
                          attr.value = chosenValue;
                          // eslint-disable-next-line no-console
                          console.log(`%c[resolveConflictAction] Set ${winning.componentName}.${winning.attributeName} = ${chosenValue}`, 
                            "color: green; font-weight: bold");
                        }
                      }
                    }
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error("[resolveConflictAction] chooseValue failed:", e);
                  }
                }

                // Handle chooseAttrValue action for simple attribute MVReg conflicts
                // Format: chooseAttrValue:attr:color:{"value":"Red","editedBy":"user1"}
                if (action.startsWith("chooseAttrValue:")) {
                  try {
                    const rest = action.slice("chooseAttrValue:".length);
                    const firstColonAfterKey = rest.indexOf(":", rest.indexOf(":") + 1);
                    const keyHint = rest.slice(0, firstColonAfterKey);
                    const chosenJson = rest.slice(firstColonAfterKey + 1);
                    const chosen = JSON.parse(chosenJson);
                    
                    // Get the component from conflict entityRefs
                    const refs = c.entityRefs?.values ? Array.from(c.entityRefs.values()) : [];
                    const compId = refs[0];
                    if (compId) {
                      const comp = g.components?.get?.(compId as any);
                      if (comp) {
                        const attrs: any = (comp as any).attrs;
                        if (attrs && typeof attrs.set === "function") {
                          // Write the chosen value to the MVReg - this collapses the conflict
                          attrs.set(keyHint, chosen);
                          
                          // Also update the underlying CVar if it exists
                          const attrName = keyHint.slice(5); // Remove "attr:" prefix
                          const cvar = (comp as any)[attrName];
                          if (cvar && typeof cvar === "object" && "value" in cvar) {
                            cvar.value = chosen.value;
                          }
                          
                          // eslint-disable-next-line no-console
                          console.log(`%c[resolveConflictAction] Resolved attr conflict: ${keyHint} = ${chosen.value}`, 
                            "color: green; font-weight: bold");
                        }
                      }
                    }
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error("[resolveConflictAction] chooseAttrValue failed:", e);
                  }
                }

                try {
                  c.status.value = "resolved";
                  try { c.resolution.value = String(action); } catch {}
                  try {
                    // eslint-disable-next-line no-console
                    console.debug("CollabProvider.resolveConflictAction: marked resolved", { conflictId, action });
                  } catch {}
                } catch {}

                return true;
              } catch (e) {
                return false;
              }
            };

            if (runtime && typeof runtime.transact === "function") {
              return new Promise<boolean>((resolve) => {
                try {
                  runtime.transact(() => {
                    const ok = doWork();
                    resolve(Boolean(ok));
                  });
                } catch (e) {
                  resolve(false);
                }
              });
            } else {
              return Promise.resolve(Boolean(doWork()));
            }
          } catch (e) {
            return false;
          }
        };

        setState({
          status: "ready",
          doc: setup.doc,
          graph: setup.graph,
          provider: providerObj,
          isConnected: connectedRef.current,
          userId: localUserId,
          getMVRegisterCandidates,
          resolveMVRegister,
          resolveConflictAction,
        });

        // Temporary dev helper: expose the collab graph for console inspection
        try {
          (window as any).__CE_GRAPH__ = setup.graph;
        } catch {}

        // Start debounced semantic resolver service
        try {
          const resolver = startConflictResolver(setup.doc, setup.graph, localUserId, {
            debounceMs: 200,
            initialDelayMs: 250,
          });
          resolverRef.stop = resolver.stop;
        } catch {
          // ignore
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("CollabProvider: could not create local doc:", e);
        setState({ status: "error", doc: null, graph: null, error: e });
      });

    return () => {
      cancelled = true;
      try {
        networkRef.current?.disconnect?.();
      } catch {}
      try {
        resolverRef.stop?.();
      } catch {}
      networkRef.current = null;
      connectedRef.current = false;
    };
  }, []);

  // ✅ E2E / testing hook: expose test API ONLY when enabled + ready
  useEffect(() => {
    if (!isE2EEnabled()) return;
    if (state.status !== "ready" || !state.graph || !state.doc) return;

    try {
      exposeTestApi({ graph: state.graph, doc: state.doc, userId: state.userId });
    } catch (e) {
      console.warn("CollabProvider: exposeTestApi failed:", e);
    }
  }, [state.status, state.graph, state.doc, state.userId]);

  return <CollabContext.Provider value={state}>{children}</CollabContext.Provider>;
};