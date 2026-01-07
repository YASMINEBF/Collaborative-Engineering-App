// src/ui/graph/EquipmentNode.tsx
import React from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import "../styles/nodes.css";

type EquipmentData = {
  label: string;
  collaboratorSelection?: { color: string; userName: string };
  lockInfo?: {
    isLocked: boolean;
    lockedBy: string | null;
    canInteract: boolean;
    color: string | null;
  };
};

export const EquipmentNode: React.FC<NodeProps<EquipmentData>> = ({
  data,
  selected,
}) => {
  const { label, collaboratorSelection, lockInfo } = data;

  const isLockedByOthers = !!lockInfo?.isLocked && !lockInfo?.canInteract;

  const borderColor = isLockedByOthers
    ? lockInfo?.color || "#ff0000"
    : selected
    ? "#FFD54F" // 👈 selected border highlight (change if you want)
    : collaboratorSelection
    ? collaboratorSelection.color
    : "#1976D2";

  const borderWidth = selected || collaboratorSelection || isLockedByOthers ? "6px" : "4px";
  const shadowClass = selected ? "node-shadow-selected" : "node-shadow";

  return (
    <div
      className={`node node-equipment ${shadowClass}`}
      style={{
        border: `${borderWidth} solid ${borderColor}`,
        cursor: isLockedByOthers ? "not-allowed" : "pointer",
        opacity: isLockedByOthers ? 0.6 : 1,
      }}
    >
      {/* Left side: allow both incoming and outgoing connections so handle position doesn't force direction */}
      <Handle type="target" position={Position.Left} id="left-target" className="node-handle" />
      <Handle type="source" position={Position.Left} id="left-source" className="node-handle" />

      <div>{label}</div>

      {collaboratorSelection && !isLockedByOthers && (
        <div
          className="node-indicator"
          style={{ backgroundColor: collaboratorSelection.color, top: "-20px" }}
        >
          {collaboratorSelection.userName}
        </div>
      )}

      {isLockedByOthers && (
        <div
          className="node-indicator"
          style={{ backgroundColor: lockInfo?.color || "#ff0000", top: "-20px" }}
        >
          🔒 {lockInfo?.lockedBy || "Locked"}
        </div>
      )}

      {/* Right side: also allow both */}
      <Handle type="target" position={Position.Right} id="right-target" className="node-handle" />
      <Handle type="source" position={Position.Right} id="right-source" className="node-handle" />
    </div>
  );
};
