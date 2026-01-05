// src/adapters/useGraphNodes.ts
import { useEffect, useState } from "react";
import type { Node } from "reactflow";
import { graphToReactFlowNodes } from "../adapters/reactFlowAdapter";

type SetupLike = {
  doc: any;
  graph: any;
} | null;

/**
 * React hook: returns React Flow nodes derived from the Collabs graph.
 * Recomputes whenever the Collabs doc emits a "Change" event.
 */
export function useGraphNodes(setup: SetupLike): Node[] {
  const [nodes, setNodes] = useState<Node[]>([]);

  useEffect(() => {
    const doc = setup?.doc;
    const graph = setup?.graph;
    if (!doc || !graph) return;

    const recompute = () => {
      try {
        setNodes(graphToReactFlowNodes(graph));
      } catch (e) {
        // Keep the UI alive even if the graph is temporarily inconsistent
        console.warn("useGraphNodes: failed to compute nodes:", e);
      }
    };

    // Initial compute
    recompute();

    // Collabs docs commonly emit "Change" at the doc/runtime level
    if (typeof doc.on === "function") {
      doc.on("Change", recompute);
    } else {
      console.warn("useGraphNodes: doc.on is not a function; cannot subscribe to changes.");
    }

    return () => {
      if (typeof doc.off === "function") {
        doc.off("Change", recompute);
      } else if (typeof doc.removeListener === "function") {
        doc.removeListener("Change", recompute);
      }
    };
  }, [setup?.doc, setup?.graph]);

  return nodes;
}
