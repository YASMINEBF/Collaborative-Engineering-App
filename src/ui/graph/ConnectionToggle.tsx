// src/ui/controls/ConnectionToggle.tsx
import React from "react";

type Props = {
  isConnected: boolean;
  onToggle: () => void;
};

export const ConnectionToggle: React.FC<Props> = ({ isConnected, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      style={{
        padding: "6px 12px",
        height: 34,
        border: "none",
        borderRadius: "6px",
        color: "white",
        cursor: "pointer",
        background: isConnected ? "#4CAF50" : "#f44336",
        fontSize: "13px",
        fontWeight: 500,
        boxShadow: "0 1px 6px rgba(0,0,0,0.12)",
      }}
    >
      {isConnected ? "Connected" : "Disconnected"}
    </button>
  );
};
export default ConnectionToggle;