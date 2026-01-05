// src/ui/editor/Sidebar.tsx
import React from "react";

type PaletteType = "equipment" | "port";

export default function Sidebar() {
  const onDragStart = (e: React.DragEvent, type: PaletteType) => {
    e.dataTransfer.setData("application/reactflow", type);
    e.dataTransfer.effectAllowed = "move";
  };

  const itemStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "6px 12px",
    border: "1px solid #bbb",
    borderRadius: 8,
    cursor: "grab",
    background: "#fff",
    fontSize: 14,
    fontWeight: 500,
    width: "fit-content",
  };

  return (
    <div
      style={{
        width: 220,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <h3 style={{ margin: 0 }}>Components</h3>

      <div
        draggable
        onDragStart={(e) => onDragStart(e, "equipment")}
        style={itemStyle}
      >
        ➕ Equipment
      </div>

      <div
        draggable
        onDragStart={(e) => onDragStart(e, "port")}
        style={itemStyle}
      >
        ➕ Port
      </div>
    </div>
  );
}
