// src/ui/graph/PortNode.tsx
import React from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import "../styles/nodes.css";

type PortData = {
  label: string;
  collaboratorSelection?: { color: string; userName: string };
  lockInfo?: {
    isLocked: boolean;
    lockedBy: string | null;
    canInteract: boolean;
    color: string | null;
  };
};

export const PortNode: React.FC<NodeProps<PortData>> = ({ data, selected }) => {
  const { label, collaboratorSelection, lockInfo } = data;

  const isLockedByOthers = !!lockInfo?.isLocked && !lockInfo?.canInteract;

  const borderColor = isLockedByOthers
    ? lockInfo?.color || "#ff0000"
    : selected
    ? "#FFD54F" // 👈 selected border highlight
    : collaboratorSelection
    ? collaboratorSelection.color
    : "#4CAF50";

  const borderWidth = selected || collaboratorSelection || isLockedByOthers ? "5px" : "3.5px";
  const shadowClass = selected ? "node-shadow-selected" : "node-shadow";

  return (
    <div
      className={`node node-port ${shadowClass}`}
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
          style={{ backgroundColor: collaboratorSelection.color, top: "-25px" }}
        >
          {collaboratorSelection.userName}
        </div>
      )}

      {isLockedByOthers && (
        <div
          className="node-indicator"
          style={{ backgroundColor: lockInfo?.color || "#ff0000", top: "-25px" }}
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
