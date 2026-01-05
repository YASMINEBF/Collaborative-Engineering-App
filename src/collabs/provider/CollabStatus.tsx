import React from "react";
import { useCollab } from "./CollabProvider";

export const CollabStatus: React.FC = () => {
  const { doc, graph } = useCollab();

  return (
    <div style={{ marginTop: 16, padding: 12, border: "1px dashed #888" }}>
      <strong>Collabs Status</strong>
      <div>Doc: {doc ? "connected" : "not initialized"}</div>
      <div>Graph: {graph ? "registered" : "not registered"}</div>
    </div>
  );
};

export default CollabStatus;
