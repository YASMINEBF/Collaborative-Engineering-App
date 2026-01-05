// src/ui/graph/GraphCanvas.tsx
import "reactflow/dist/style.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from "reactflow";

import { useCollab } from "../../collabs/provider/CollabProvider";
import { useGraphNodes } from "../../hooks/useGraphNodes";

import { EquipmentNode } from "./EquipmentNode";
import { PortNode } from "./PortNode";

import { setComponentPosition, deleteComponent } from "../../collabs/commands/components";

export type PaletteType = "equipment" | "port";

function InnerCanvas(props: {
  onDropped: (type: PaletteType, position: { x: number; y: number }) => void;
}) {
  const { onDropped } = props;

  const { doc, graph, status } = useCollab();
  const computedNodes = useGraphNodes(status === "ready" ? { doc, graph } : null);

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const reactFlow = useReactFlow();

  const nodeTypes = useMemo(
    () => ({
      equipment: EquipmentNode,
      port: PortNode,
    }),
    []
  );

  // Sync local ReactFlow nodes from Collabs-derived nodes,
  // but preserve UI-only fields like "selected".
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return computedNodes.map((n) => {
        const old = prevById.get(n.id);
        return {
          ...n,
          selected: old?.selected ?? false,
        };
      });
    });
  }, [computedNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // Persist position back to Collabs when user finishes dragging.
  const onNodeDragStop = useCallback(
    (_: any, node: Node) => {
      if (status !== "ready" || !graph) return;
      setComponentPosition(graph, node.id, node.position);
    },
    [graph, status]
  );

  // Delete from Collabs (source of truth). ReactFlow will update after doc change.
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (status !== "ready" || !graph) return;
      for (const n of deleted) deleteComponent(graph, n.id);
    },
    [graph, status]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();

      const type = e.dataTransfer.getData("application/reactflow") as PaletteType;
      if (type !== "equipment" && type !== "port") return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = reactFlow.project({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      onDropped(type, position);
    },
    [onDropped, reactFlow]
  );

  if (status === "loading") return <div>Loading collab…</div>;
  if (status === "error") return <div>Could not initialize collaboration.</div>;
  if (!doc || !graph) return <div>Not ready.</div>;

  return (
    <div
      ref={wrapperRef}
      style={{
        width: "100%",
        height: "100%",
        border: "1px solid #ddd",
        borderRadius: 8,
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        fitView
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        deleteKeyCode={["Backspace", "Delete"]} // ✅ press Del/Backspace to delete selected nodes
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function GraphCanvas(props: {
  onDropped: (type: PaletteType, position: { x: number; y: number }) => void;
}) {
  return (
    <ReactFlowProvider>
      <InnerCanvas onDropped={props.onDropped} />
    </ReactFlowProvider>
  );
}
