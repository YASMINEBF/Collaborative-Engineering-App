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
            const g = (setup as any).graph as any;
            if (!g || !g.conflicts) return false;
            const c = g.conflicts.get(conflictId);
            if (!c) return false;

            const refs: string[] = [];
            try {
              const iter = c.entityRefs?.values ? c.entityRefs.values() : [];
              for (const v of iter) refs.push(String(v));
            } catch {}

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
                }

                try {
                  c.status.value = "resolved";
                  try { c.resolution.value = String(action); } catch {}
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
