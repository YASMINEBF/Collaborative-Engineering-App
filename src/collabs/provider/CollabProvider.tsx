// src/collabs/provider/CollabProvider.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { createLocalDoc } from "./docSetup";
import startConflictResolver from "../semantics/conflictResolver";

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
};

const CollabContext = createContext<CollabContextType>({
  status: "loading",
  doc: null,
  graph: null,
});

export function useCollab() {
  return useContext(CollabContext);
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
        } catch (e) {
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
        } catch (e) {
          localUserId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }

        setState({
          status: "ready",
          doc: setup.doc,
          graph: setup.graph,
          provider: providerObj,
          isConnected: connectedRef.current,
          userId: localUserId,
        });

        // Start a separate conflict resolver service which debounces and defers
        // calls to `resolveUniqueNames`. This keeps the provider lightweight and
        // makes the resolver easier to test / replace.
        try {
          const resolver = startConflictResolver(setup.doc, setup.graph, localUserId, {
            debounceMs: 200,
            initialDelayMs: 250,
          });
          resolverRef.stop = resolver.stop;
        } catch (e) {
          // ignore if unable to start resolver
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

  return <CollabContext.Provider value={state}>{children}</CollabContext.Provider>;
};
