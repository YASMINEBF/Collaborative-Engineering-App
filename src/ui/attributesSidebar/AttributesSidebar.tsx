import React, { useEffect, useMemo, useState, useCallback } from "react";
import { FaChevronLeft, FaChevronRight, FaTimes } from "react-icons/fa";
import { useCollab } from "../../collabs/provider/CollabProvider";
import AttributeRow from "./AttributeRow";
import { equipmentAttributes, portAttributes } from "./attributeSchema";
import "../styles/attributesSidebar.css";

type Props = {
  selectedNodeId: string | null;
  onClose?: () => void;

  // lock overlay
  isReadOnly?: boolean;
  lockedBy?: string;
};

export default function AttributesSidebar({
  selectedNodeId,
  onClose,
  isReadOnly = false,
  lockedBy,
}: Props) {
  const { status, graph } = useCollab();
  const [isCollapsed, setIsCollapsed] = useState(true);

  // auto-open when a node gets selected (optional but feels nice)
  useEffect(() => {
    if (selectedNodeId) setIsCollapsed(false);
  }, [selectedNodeId]);

  const selectedComponent = useMemo(() => {
    if (status !== "ready" || !graph || !selectedNodeId) return null;
    return graph.components.get(selectedNodeId) ?? null;
  }, [status, graph, selectedNodeId]);

  const type = selectedComponent?.type?.value ?? null;
  const schema = type === "equipment" ? equipmentAttributes : type === "port" ? portAttributes : [];

  const toggleCollapsed = () => setIsCollapsed((v) => !v);

  // ---- write helpers (keep these tiny; they just set collabs vars) ----
  const setVar = useCallback((key: string, newValue: any) => {
    if (status !== "ready" || !graph || !selectedComponent) return;
    // guard: only if exists
    const field = (selectedComponent as any)[key];
    if (!field || typeof field !== "object" || !("value" in field)) return;
    field.value = newValue;
  }, [status, graph, selectedComponent]);

  if (!selectedComponent) return null;

  return (
    <div
      className="attr-sidebar-shell"
      style={{ right: isCollapsed ? "-280px" : "0" }}
    >
      {/* Toggle button */}
      <button
        className="attr-toggle"
        onClick={toggleCollapsed}
        title={isCollapsed ? "Open" : "Collapse"}
      >
        {isCollapsed ? <FaChevronLeft /> : <FaChevronRight />}
      </button>

      <div className="attr-sidebar-inner">
        {/* Header */}
        <div className="attr-header">
          <h3 className="attr-header-title">Component Details</h3>

          {onClose && (
            <button className="attr-close" onClick={onClose} title="Close">
              <FaTimes />
            </button>
          )}
        </div>

        {/* Lock banner */}
        {isReadOnly && (
          <div className="attr-lock-banner">
            <span className="lock-icon">🔒</span>
            <span className="lock-text">
              Attributes locked by {lockedBy || "another user"}
            </span>
          </div>
        )}

        <div className="attr-scroll">
          {/* Basic info */}
          <div className="attr-card">
            <div className="attr-kv">
              <span className="k">ID</span>
              <span className="v mono">{selectedNodeId}</span>
            </div>
            <div className="attr-kv">
              <span className="k">Type</span>
              <span className="v pill">{type}</span>
            </div>
          </div>

          {/* Editable attributes */}
          <div
            className="attr-card"
            style={{
              pointerEvents: isReadOnly ? "none" : "auto",
              opacity: isReadOnly ? 0.6 : 1,
              cursor: isReadOnly ? "not-allowed" : "default",
            }}
          >
            <div className="attr-section-title">Attributes</div>

            {schema.map((def) => (
              <AttributeRow
                key={def.key}
                def={def as any}
                value={(selectedComponent as any)[def.key]?.value}
                disabled={isReadOnly}
                onChange={(val) => setVar(def.key, val)}
              />
            ))}
          </div>

          {/* Relationships section can be added right below (next step) */}
        </div>
      </div>
    </div>
  );
}
