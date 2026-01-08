// src/ui/Editor.tsx
import { useCallback, useState } from "react";

import Sidebar from "./sidebar/Sidebar";
import GraphCanvas from "./graph/GraphCanvas";
import NameModal from "./sidebar/NameModal";
import { useGraphDnDCreate } from "../hooks/useGraphDnDCreate";

import AttributesSidebar from "./attributesSidebar/Attributessidebar"; // ✅ adjust path if needed

// Connection toggle is rendered inside the graph canvas now.

export default function Editor() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { pending, title, showPortType, openForDrop, cancel, confirm, error, clearError } =
    useGraphDnDCreate();

  const closeAttributes = useCallback(() => setSelectedNodeId(null), []);

  return (
    <div style={{ width: "100%", height: "85vh", display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Main editor row */}
      <div style={{ display: "flex", gap: 8, flex: 1, alignItems: "stretch", minHeight: 0 }}>
        <div style={{ width: 180, flexShrink: 0 }}>
          <Sidebar />
        </div>

        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
          <GraphCanvas onDropped={openForDrop} onSelectNode={setSelectedNodeId} />
        </div>

        {/* ✅ Right-side attributes sidebar */}
        <AttributesSidebar selectedNodeId={selectedNodeId} onClose={closeAttributes} />

        {/* Name modal */}
        <NameModal
          open={!!pending}
          title={title}
          placeholder="Component name"
          showPortType={showPortType}
          error={error}
          onChangeValue={clearError}
          onCancel={cancel}
          onConfirm={confirm}
        />
      </div>
    </div>
  );
}
