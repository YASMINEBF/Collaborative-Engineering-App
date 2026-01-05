// src/hooks/useGraphEdges.ts
import { useEffect, useState } from "react";
import type { Edge } from "reactflow";
import { graphToReactFlowEdges } from "../adapters/reactFlowAdapter";

type SetupLike = { doc: any; graph: any } | null;

export function useGraphEdges(setup: SetupLike): Edge[] {
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const doc = setup?.doc;
    const graph = setup?.graph;
    if (!doc || !graph) return;

    const recompute = () => {
      try {
        setEdges(graphToReactFlowEdges(graph));
      } catch (e) {
        console.warn("useGraphEdges: failed to compute edges:", e);
      }
    };

    recompute();

    if (typeof doc.on === "function") doc.on("Change", recompute);

    return () => {
      if (typeof doc.off === "function") doc.off("Change", recompute);
      else if (typeof doc.removeListener === "function") doc.removeListener("Change", recompute);
    };
  }, [setup?.doc, setup?.graph]);

  return edges;
}
