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
  type Connection,
  type Edge,
} from "reactflow";

import { useCollab } from "../../collabs/provider/CollabProvider";
import ConnectionToggle from "./ConnectionToggle";
import { useGraphNodes } from "../../hooks/useGraphNodes";
import { useGraphEdges } from "../../hooks/useGraphEdges";

import { EquipmentNode } from "./EquipmentNode";
import { PortNode } from "./PortNode";

import { setComponentPosition, deleteComponent } from "../../collabs/commands/components";
import { createRelationship, deleteRelationship } from "../../collabs/commands/relationships";

import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import ConnectionMenu from "./ConnectionMenu";

import "../styles/edges.css"; // edge-haspart/edge-controls/edge-feeds

export type PaletteType = "equipment" | "port";

type PendingConnect = {
  conn: Connection;
  menuPos: { x: number; y: number }; // coords in wrapper space
};

function InnerCanvas(props: {
  onDropped: (type: PaletteType, position: { x: number; y: number }) => void;
}) {
  const { onDropped } = props;

  const { doc, graph, status, provider, isConnected } = useCollab();

  const computedNodes = useGraphNodes(status === "ready" ? { doc, graph } : null);
  const computedEdges = useGraphEdges(status === "ready" ? { doc, graph } : null);

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const reactFlow = useReactFlow();

  const nodeTypes = useMemo(
    () => ({
      equipment: EquipmentNode,
      port: PortNode,
    }),
    []
  );

  // Sync nodes (preserve selection)
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return computedNodes.map((n) => {
        const old = prevById.get(n.id);
        return { ...n, selected: old?.selected ?? false };
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

  // Delete from Collabs (source of truth).
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (status !== "ready" || !graph) return;
      for (const n of deleted) deleteComponent(graph, n.id);
    },
    [graph, status]
  );

  // Delete edges from Collabs when removed from the canvas (source of truth).
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (status !== "ready" || !graph) return;
      for (const e of deleted) deleteRelationship(graph, e.id);
    },
    [graph, status]
  );

  // ===== Drag & Drop create components =====

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

      const position = reactFlow.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    });

      onDropped(type, position);
    },
    [onDropped, reactFlow]
  );

  // ===== Connect → open menu near target =====

  const onConnect = useCallback(
    (conn: Connection) => {
      if (status !== "ready" || !graph) return;
      if (!conn.source || !conn.target) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const targetNode = reactFlow.getNode(conn.target);
      if (!targetNode) return;

      // Convert target node flow coords -> wrapper screen coords
      const { x: vx, y: vy, zoom } = reactFlow.getViewport();

      // Place menu near the target node (top-right-ish).
      // This uses node position; if you want exact center, we can refine later using measured size.
      const menuX = targetNode.position.x * zoom + vx + 140;
      const menuY = targetNode.position.y * zoom + vy + 10;

      setPendingConnect({
        conn,
        menuPos: { x: menuX, y: menuY },
      });
    },
    [graph, status, reactFlow]
  );

  const closeMenu = useCallback(() => setPendingConnect(null), []);

  const toggleConnection = useCallback(() => {
    if (!provider) return;
    if (isConnected) provider.disconnect();
    else provider.connect();
  }, [provider, isConnected]);

  const onChooseConnectionType = useCallback(
    (kind: RelationshipKind | "") => {
      // "" means cancel
      if (!pendingConnect) return;

      const { conn } = pendingConnect;
      setPendingConnect(null);

      if (!kind) return;
      if (status !== "ready" || !graph) return;
      if (!conn.source || !conn.target) return;

      const id = `rel-${Date.now()}`;
      // medium = null for now (you can add a second small prompt for feeds later)
      // preserve the handle ids the user connected to so the edge attaches correctly
      createRelationship(
        graph,
        id,
        kind,
        conn.source,
        conn.target,
        null,
        (conn as any).sourceHandle ?? null,
        (conn as any).targetHandle ?? null
      );
    },
    [pendingConnect, graph, status]
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
        position: "relative", //  needed so menu can be absolutely positioned
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={computedEdges as Edge[]}
        nodeTypes={nodeTypes}
        fitView
        connectionRadius={40}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        deleteKeyCode={["Backspace", "Delete"]}
        nodesDraggable
        nodesConnectable
        elementsSelectable
      >
        <Background />
        <Controls />
      </ReactFlow>

      <ConnectionMenu
        position={pendingConnect?.menuPos ?? null}
        onChoose={onChooseConnectionType}
        onClose={closeMenu}
      />

      {/* Connection toggle placed bottom-right inside the graph wrapper */}
      <div style={{ position: "absolute", right: 12, bottom: 20, zIndex: 100 }}>
        <ConnectionToggle isConnected={!!isConnected} onToggle={toggleConnection} />
      </div>
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
