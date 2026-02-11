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
import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";
import ConnectionMenu from "./ConnectionMenu";

import "../styles/edges.css"; // edge-haspart/edge-controls/edge-feeds

export type PaletteType = "equipment" | "port";

type PendingConnect = {
  conn: Connection;
  menuPos: { x: number; y: number }; // coords in wrapper space
};

function InnerCanvas(props: {
  onDropped: (type: PaletteType, position: { x: number; y: number }) => void;
  onSelectNode: (id: string | null) => void;
}) {
  const { onDropped } = props;

  const { doc, graph, status, provider, isConnected } = useCollab();

  const computedNodes = useGraphNodes(status === "ready" ? { doc, graph } : null);
  const computedEdges = useGraphEdges(status === "ready" ? { doc, graph } : null);

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const reactFlow = useReactFlow();

  /**
   * ReactFlow (your version) fires onEdgesDelete BEFORE onNodesDelete when deleting a node.
   * We therefore set this flag as early as possible (keydown capture) so onEdgesDelete can ignore
   * those edge deletions, and deleteComponent can still read the incoming hasPart edge to compute
   * the grandparent.
   */
  const deletingNodeRef = useRef(false);

  // Track currently selected node ids so we know if Delete/Backspace will delete nodes.
  const selectedNodeIdsRef = useRef<string[]>([]);

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

  // ----- Pre-delete flagging (needed because onEdgesDelete can fire first) -----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;

      // If any nodes are selected, a delete keypress will likely delete nodes + their edges.
      if (selectedNodeIdsRef.current.length > 0) {
        deletingNodeRef.current = true;

        // Release quickly; onNodesDelete also releases in finally.
        setTimeout(() => {
          deletingNodeRef.current = false;
        }, 0);
      }
    };

    // Capture phase so we run before ReactFlow handlers.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Delete from Collabs (source of truth).
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (status !== "ready" || !graph) return;

      // Keep flag on during our deleteComponent mutations
      deletingNodeRef.current = true;
      try {
        for (const n of deleted) deleteComponent(graph, n.id);
      } finally {
        setTimeout(() => {
          deletingNodeRef.current = false;
        }, 0);
      }
    },
    [graph, status]
  );

  // Delete edges from Collabs when removed from the canvas (source of truth).
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      // ✅ Ignore edge deletions fired as a side-effect of node deletion
      if (deletingNodeRef.current) return;

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

  // Selection (also track selected nodes for pre-delete detection)
  const onSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[]; edges: Edge[] }) => {
      selectedNodeIdsRef.current = nodes.map((n) => n.id);
      props.onSelectNode(nodes.length ? nodes[0].id : null);
    },
    [props.onSelectNode]
  );

  const onPaneClick = useCallback(() => {
    selectedNodeIdsRef.current = [];
    props.onSelectNode(null);
  }, [props.onSelectNode]);

  // ===== Connect → open menu near target =====

  const onConnect = useCallback(
    (conn: Connection) => {
      if (status !== "ready" || !graph) return;
      if (!conn.source || !conn.target) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const targetNode = reactFlow.getNode(conn.target);
      if (!targetNode) return;

      const { x: vx, y: vy, zoom } = reactFlow.getViewport();
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
      if (!pendingConnect) return;

      const { conn } = pendingConnect;
      setPendingConnect(null);

      if (!kind) return;
      if (status !== "ready" || !graph) return;
      if (!conn.source || !conn.target) return;

      if (kind === PhysicalKind.Feeds) {
        try {
          const srcId = String(conn.source);
          const tgtId = String(conn.target);
          const src = graph.components?.get ? graph.components.get(srcId) : graph.components?.[srcId];
          const tgt = graph.components?.get ? graph.components.get(tgtId) : graph.components?.[tgtId];
          const srcOut = src?.outputMedium?.value;
          const tgtIn = tgt?.inputMedium?.value;
          if (srcOut !== undefined && tgtIn !== undefined && srcOut !== tgtIn) {
            const title = "Invalid feeds connection";
            const message = `Cannot connect: source output (${String(srcOut)}) ≠ target input (${String(tgtIn)})`;
            window.dispatchEvent(new CustomEvent("ce:notification", { detail: { type: "notify", title, message } }));
            return;
          }
        } catch {
          // ignore and let createRelationship handle conflicts
        }
      }

      // Generate a collision-proof relationship ID
      const randomPart = Math.random().toString(36).slice(2, 10);
      const id = `rel-${Date.now()}-${randomPart}`;
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
        position: "relative",
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
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
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

      <div style={{ position: "absolute", right: 12, bottom: 20, zIndex: 100 }}>
        <ConnectionToggle isConnected={!!isConnected} onToggle={toggleConnection} />
      </div>
    </div>
  );
}

export default function GraphCanvas(props: {
  onDropped: (type: PaletteType, position: { x: number; y: number }) => void;
  onSelectNode: (id: string | null) => void;
}) {
  return (
    <ReactFlowProvider>
      <InnerCanvas onDropped={props.onDropped} onSelectNode={props.onSelectNode} />
    </ReactFlowProvider>
  );
}
