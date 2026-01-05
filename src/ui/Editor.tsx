// src/ui/Editor.tsx
import Sidebar from "./sidebar/Sidebar";
import GraphCanvas from "./graph/GraphCanvas";
import NameModal from "./sidebar/NameModal";
import { useGraphDnDCreate } from "../hooks/useGraphDnDCreate";

export default function Editor() {
  const { pending, title, openForDrop, cancel, confirm, error, clearError } =
    useGraphDnDCreate();

  return (
    <div style={{ display: "flex", gap: 8, width: "100%", height: "85vh", alignItems: "stretch" }}>
      <div style={{ width: 180, flexShrink: 0 }}>
        <Sidebar />
      </div>

      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <GraphCanvas onDropped={openForDrop} />
      </div>

      <NameModal
        open={!!pending}
        title={title}
        placeholder="Component name"
        error={error}
        onChangeValue={clearError}
        onCancel={cancel}
        onConfirm={confirm}
      />
    </div>
  );
}
