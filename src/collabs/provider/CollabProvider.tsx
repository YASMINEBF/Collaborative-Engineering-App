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
                // CRITICAL: Mark conflict as resolved FIRST, before any deletions.
                // This prevents the resolver from re-resurrecting nodes/edges
                // when it sees the deletion-triggered Update event.
                try {
                  c.status.value = "resolved";
                  try { c.resolution.value = String(action); } catch {}
                  try { c.resolvedBy.value = localUserId ?? "unknown"; } catch {}
                  try { c.resolvedAt.value = Date.now(); } catch {}
                  // eslint-disable-next-line no-console
                  console.debug("CollabProvider.resolveConflictAction: marked resolved FIRST", { conflictId, action });
                } catch {}

                if (action === "deleteBoth") {
                  // HARD DELETE: Remove from CRDT maps AND clean up deletion logs
                  // so nothing can ever be resurrected again.
                  
                  // First, collect all node and edge IDs we're deleting
                  const nodeIdsToHardDelete = new Set<string>();
                  const edgeIdsToHardDelete = new Set<string>();
                  
                  for (const id of refs) {
                    if (g.components && typeof g.components.get === "function" && g.components.get(id)) {
                      nodeIdsToHardDelete.add(String(id));
                    }
                    if (g.relationships && typeof g.relationships.get === "function" && g.relationships.get(id)) {
                      edgeIdsToHardDelete.add(String(id));
                    }
                  }
                  
                  // Delete edges first
                  for (const id of edgeIdsToHardDelete) {
                    try {
                      deleteRelationship(g, id as any, { recordSnapshot: false }); // Don't record 
                    } catch {}
                  }
                  
                  // Delete nodes (this will cascade-delete any remaining incident edges)
                  for (const id of nodeIdsToHardDelete) {
                    try {
                      deleteComponent(g, id as any, localUserId ?? "user");
                    } catch {}
                  }
                  
                  // PURGE from deletion logs - prevent any future resurrection
                  for (const id of nodeIdsToHardDelete) {
                    try {
                      g.deletionLog?.delete?.(String(id));
                      // eslint-disable-next-line no-console
                      console.log(`%c[deleteBoth] PURGED node ${id} from deletionLog`, "color: red; font-weight: bold");
                    } catch {}
                  }
                  
                  for (const id of edgeIdsToHardDelete) {
                    try {
                      g.relationshipDeletionLog?.delete?.(String(id));
                      // eslint-disable-next-line no-console
                      console.log(`%c[deleteBoth] PURGED edge ${id} from relationshipDeletionLog`, "color: red; font-weight: bold");
                    } catch {}
                  }
                  
                  // Also purge any edges that were incident to the deleted nodes
                  // (they may be in the log but not in refs)
                  try {
                    if (g.relationshipDeletionLog && typeof g.relationshipDeletionLog.entries === "function") {
                      const edgesToPurge: string[] = [];
                      for (const [edgeId, rec] of g.relationshipDeletionLog.entries()) {
                        const src = String(rec.sourceId ?? "");
                        const tgt = String(rec.targetId ?? "");
                        if (nodeIdsToHardDelete.has(src) || nodeIdsToHardDelete.has(tgt)) {
                          edgesToPurge.push(String(edgeId));
                        }
                      }
                      for (const edgeId of edgesToPurge) {
                        try {
                          g.relationshipDeletionLog.delete(edgeId);
                          // eslint-disable-next-line no-console
                          console.log(`%c[deleteBoth] PURGED incident edge ${edgeId} from relationshipDeletionLog`, "color: red");
                        } catch {}
                      }
                    }
                  } catch {}
                  
                } else if (action === "keepBoth") {
                  // Restore nodes AND cascade-deleted edges (edges deleted because node was deleted)
                  // Do NOT restore edges that were explicitly deleted by user
                  try {
                    // Step 1: Restore nodes
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
                          // Component exists (tombstone) — clear the flags to un-delete it
                          try { if (comp.isDeleted && comp.isDeleted.value === true) comp.isDeleted.value = false; } catch {}
                          try { if (comp.deletedAt && comp.deletedAt.value != null) comp.deletedAt.value = null; } catch {}
                          try { if (comp.deletedBy && comp.deletedBy.value != null) comp.deletedBy.value = null; } catch {}
                        }
                      } catch {}
                    }

                    // Step 2: Find cascade-deleted edges to restore
                    const restoredNodeIds = new Set<string>();
                    for (const id of refs) {
                      try {
                        if (g.components && typeof g.components.get === "function" && g.components.get(id)) {
                          restoredNodeIds.add(String(id));
                        }
                      } catch {}
                    }
                    
                    // Only restore edges where cascadeFromNodeId matches a restored node
                    try {
                      if (g.relationshipDeletionLog) {
                        for (const [edgeId, rec] of g.relationshipDeletionLog.entries()) {
                          try {
                            // ONLY restore CASCADE deletes
                            if (rec.isCascade !== true) continue;
                            
                            // KEY FIX: Only restore if THIS node's deletion caused the cascade
                            // (not just any cascade that happens to involve this node)
                            const cascadeFrom = rec.cascadeFromNodeId;
                            if (!cascadeFrom || !restoredNodeIds.has(String(cascadeFrom))) continue;
                            
                            // Skip if edge already exists
                            if (g.relationships.get(String(edgeId))) continue;
                            
                            // Check both endpoints exist
                            const srcExists = !!g.components.get(String(rec.sourceId));
                            const tgtExists = !!g.components.get(String(rec.targetId));
                            if (!srcExists || !tgtExists) continue;
                            
                            // Restore the edge
                            // eslint-disable-next-line no-console
                            console.log(`%c[keepBoth] Restoring edge ${edgeId} (cascade from ${cascadeFrom})`, "color: green");
                            g.relationships.set(
                              String(edgeId),
                              rec.type ?? "relationship",
                              rec.kind,
                              rec.sourceId,
                              rec.targetId,
                              rec.medium ?? null,
                              rec.sourceHandle ?? null,
                              rec.targetHandle ?? null
                            );
                            
                            // Remove from deletion log
                            g.relationshipDeletionLog.delete(String(edgeId));
                          } catch {}
                        }
                      }
                    } catch {}
                    
                    // Step 3: Cleanup - remove restored nodes from deletionLog
                    for (const id of restoredNodeIds) {
                      try {
                        g.deletionLog?.delete?.(String(id));
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
                          
                          // Store what was chosen for other users to see
                          try {
                            c.winningValue.value = { key: keyHint, chosenValue: chosen, resolvedBy: localUserId };
                          } catch {}
                          
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

                // Handle choosePairValue action for semantic pair conflicts (pair:dims, pair:nameDesc, pair:valueUnit)
                // Format: choosePairValue:pair:dims:{"width":100,"height":200,"unit":"mm"}
                if (action.startsWith("choosePairValue:")) {
                  try {
                    const rest = action.slice("choosePairValue:".length);
                    // Parse: pair:dims:{json} or pair:nameDesc:{json} or pair:valueUnit:{json}
                    const match = rest.match(/^(pair:\w+):(.+)$/);
                    if (match) {
                      const keyHint = match[1];
                      const chosen = JSON.parse(match[2]);
                      
                      // Get the component from conflict entityRefs
                      const refs = c.entityRefs?.values ? Array.from(c.entityRefs.values()) : [];
                      const compId = refs[0];
                      if (compId) {
                        const comp = g.components?.get?.(compId as any);
                        if (comp) {
                          const attrs: any = (comp as any).attrs;
                          
                          if (keyHint === "pair:dims") {
                            // Apply dims: width, height, unit
                            try { if ((comp as any).width) (comp as any).width.value = chosen.width; } catch {}
                            try { if ((comp as any).height) (comp as any).height.value = chosen.height; } catch {}
                            try {
                              if ((comp as any).widthUnit) (comp as any).widthUnit.value = chosen.unit;
                              if ((comp as any).heightUnit) (comp as any).heightUnit.value = chosen.unit;
                            } catch {}
                            if (attrs && typeof attrs.set === "function") {
                              attrs.set("pair:dims", chosen);
                            }
                            // Store what was chosen for other users to see
                            try {
                              c.winningValue.value = { key: keyHint, chosenValue: chosen, resolvedBy: localUserId };
                            } catch {}
                          } else if (keyHint === "pair:nameDesc") {
                            // Apply name + description
                            try { if ((comp as any).name) (comp as any).name.value = chosen.name; } catch {}
                            try { if ((comp as any).description) (comp as any).description.value = chosen.description; } catch {}
                            if (attrs && typeof attrs.set === "function") {
                              attrs.set("pair:nameDesc", chosen);
                            }
                            // Store what was chosen for other users to see
                            try {
                              c.winningValue.value = { key: keyHint, chosenValue: chosen, resolvedBy: localUserId };
                            } catch {}
                          } else if (keyHint === "pair:valueUnit") {
                            // Apply value + unit
                            try { if ((comp as any).value) (comp as any).value.value = chosen.value; } catch {}
                            try { if ((comp as any).unit) (comp as any).unit.value = chosen.unit; } catch {}
                            if (attrs && typeof attrs.set === "function") {
                              attrs.set("pair:valueUnit", chosen);
                            }
                            // Store what was chosen for other users to see
                            try {
                              c.winningValue.value = { key: keyHint, chosenValue: chosen, resolvedBy: localUserId };
                            } catch {}
                          }
                          
                          // eslint-disable-next-line no-console
                          console.log(`%c[resolveConflictAction] Resolved pair conflict: ${keyHint} = ${JSON.stringify(chosen)}`, 
                            "color: green; font-weight: bold");
                        }
                      }
                    }
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error("[resolveConflictAction] choosePairValue failed:", e);
                  }
                }

                // Handle InvalidFeedCardinality: keep one edge, delete the rest
                if (action.startsWith("deleteOneEdge:")) {
                  try {
                    const keepEdgeId = action.slice("deleteOneEdge:".length);
                    const meta = c.winningValue?.value as any;
                    const competingEdges: string[] = meta?.competingEdges ?? (c.losingValues?.value as any) ?? [];
                    for (const eid of competingEdges) {
                      if (String(eid) !== keepEdgeId) {
                        try { deleteRelationship(g, String(eid), { deletedBy: localUserId ?? "user", recordSnapshot: true }); } catch {}
                      }
                    }
                    try {
                      c.winningValue.value = { keptEdge: keepEdgeId, resolvedBy: localUserId };
                    } catch {}
                    // eslint-disable-next-line no-console
                    console.log(`%c[resolveConflictAction] Kept edge ${keepEdgeId}, deleted others`, "color: green; font-weight: bold");
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error("[resolveConflictAction] deleteOneEdge failed:", e);
                  }
                }

                // Handle FeedMediumMismatch: deleteFeeds action
                if (action === "deleteFeeds") {
                  try {
                    // Find the relationship ID from entityRefs and delete it
                    for (const ref of refs) {
                      try {
                        const rel = g.relationships.get(String(ref));
                        if (rel) {
                          // Delete the feeds relationship
                          deleteRelationship(g, String(ref));
                          // eslint-disable-next-line no-console
                          console.log(`%c[resolveConflictAction] Deleted feeds relationship: ${ref}`, "color: orange; font-weight: bold");
                        }
                      } catch {}
                    }
                    // Store resolution info
                    try {
                      c.winningValue.value = { action: "deleteFeeds", resolvedBy: localUserId };
                    } catch {}
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error("[resolveConflictAction] deleteFeeds failed:", e);
                  }
                }

                // Handle FeedMediumMismatch: revertMedium action
                if (action.startsWith("revertMedium:")) {
                  try {
                    const direction = action.slice("revertMedium:".length); // "useTarget" or "useSource"
                    const meta = c.winningValue?.value as any;
                    const srcOut = meta?.srcOut;
                    const tgtIn = meta?.tgtIn;
                    
                    // Find source and target component IDs from entityRefs
                    let relId: string | null = null;
                    for (const ref of refs) {
                      if (g.relationships.get(String(ref))) {
                        relId = String(ref);
                        break;
                      }
                    }
                    
                    if (relId) {
                      const rel = g.relationships.get(relId);
                      const srcId = rel?.sourceId?.value;
                      const tgtId = rel?.targetId?.value;
                      
                      if (direction === "useTarget" && srcId) {
                        // Set source's outputMedium to target's inputMedium
                        const src = g.components.get(srcId);
                        if (src && (src as any).outputMedium) {
                          (src as any).outputMedium.value = tgtIn;
                          // eslint-disable-next-line no-console
                          console.log(`%c[resolveConflictAction] Set source ${srcId} outputMedium = "${tgtIn}"`, "color: green; font-weight: bold");
                        }
                      } else if (direction === "useSource" && tgtId) {
                        // Set target's inputMedium to source's outputMedium
                        const tgt = g.components.get(tgtId);
                        if (tgt && (tgt as any).inputMedium) {
                          (tgt as any).inputMedium.value = srcOut;
                          // eslint-disable-next-line no-console
                          console.log(`%c[resolveConflictAction] Set target ${tgtId} inputMedium = "${srcOut}"`, "color: green; font-weight: bold");
                        }
                      }
                    }
                    
                    // Store resolution info
                    try {
                      c.winningValue.value = { 
                        action: "revertMedium", 
                        direction, 
                        chosenValue: direction === "useTarget" ? tgtIn : srcOut,
                        resolvedBy: localUserId 
                      };
                    } catch {}
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error("[resolveConflictAction] revertMedium failed:", e);
                  }
                }

                // Note: conflict was already marked resolved at the TOP of doWork()
                // (before any deletions) to prevent resolver race conditions

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

  //  E2E / testing hook: expose test API ONLY when enabled + ready
  useEffect(() => {
    if (!isE2EEnabled()) return;
    if (state.status !== "ready" || !state.graph || !state.doc) return;

    try {
      exposeTestApi({ graph: state.graph, doc: state.doc, userId: state.userId, network: (state.provider as any)?.network });
    } catch (e) {
      console.warn("CollabProvider: exposeTestApi failed:", e);
    }
  }, [state.status, state.graph, state.doc, state.userId]);

  return <CollabContext.Provider value={state}>{children}</CollabContext.Provider>;
};