// src/collabs/provider/CollabProvider.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { createLocalDoc } from "./docSetup";

export type CollabStatus = "loading" | "ready" | "error";

export type CollabContextType = {
  status: CollabStatus;
  doc: any | null;
  graph: any | null;
  error?: unknown;
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
  });

  const networkRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    createLocalDoc()
      .then((setup) => {
        if (cancelled) return;
        networkRef.current = (setup as any).network ?? null;

        setState({
          status: "ready",
          doc: setup.doc,
          graph: setup.graph,
        });
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
      networkRef.current = null;
    };
  }, []);

  return <CollabContext.Provider value={state}>{children}</CollabContext.Provider>;
};
