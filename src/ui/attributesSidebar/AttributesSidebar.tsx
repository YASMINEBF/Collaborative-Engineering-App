import { useEffect, useMemo, useState, useCallback } from "react";
import { FaChevronLeft, FaChevronRight, FaTimes } from "react-icons/fa";
import { useCollab } from "../../collabs/provider/CollabProvider";
import AttributeRow from "./AttributeRow";
import { equipmentAttributes, portAttributes, capacityUnitOptionsFor } from "./attributeSchema";
import { validateAndNotifyIfBlocked } from "../../collabs/semantics/mediaChangeValidator";
import resolveFeedMediumConflicts from "../../collabs/semantics/resolveFeedMediumConflicts";
import "../styles/attributesSidebar.css";

type Props = {
  selectedNodeId: string | null;
  onClose?: () => void;
  isReadOnly?: boolean;
  lockedBy?: string;
};

export default function AttributesSidebar({
  selectedNodeId,
  onClose,
  isReadOnly = false,
  lockedBy,
}: Props) {
  const { status, graph, doc, userId } = useCollab();
  const [, setTick] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    if (selectedNodeId) setIsCollapsed(true);
  }, [selectedNodeId]);

  const selectedComponent = useMemo(() => {
    if (status !== "ready" || !graph || !selectedNodeId) return null;
    return graph.components.get(selectedNodeId) ?? null;
  }, [status, graph, selectedNodeId]);

  useEffect(() => {
    if (!doc || status !== "ready") return;
    const onChange = () => setTick((t) => t + 1);
    doc.on?.("Change", onChange);
    return () => doc.off?.("Change", onChange);
  }, [doc, status]);

  const type = selectedComponent?.type?.value ?? null;
  const schema =
    type === "equipment" ? equipmentAttributes :
    type === "port" ? portAttributes : [];

  const setVar = useCallback((key: string, value: any) => {
    if (!selectedComponent) return;
    // If editing equipment media, validate against feeds relationships
    if ((key === "inputMedium" || key === "outputMedium") && (selectedComponent as any).type?.value === "equipment") {
      try {
        const newInput = key === "inputMedium" ? value : (selectedComponent as any)["inputMedium"]?.value;
        const newOutput = key === "outputMedium" ? value : (selectedComponent as any)["outputMedium"]?.value;
        const allowed = validateAndNotifyIfBlocked((graph as any), (selectedComponent as any).id?.value ?? (selectedComponent as any).id, newInput, newOutput);
        if (!allowed) return;
      } catch (e) {
        // fall back to direct set if validation fails unexpectedly
      }
    }

    const field = (selectedComponent as any)[key];
    if (field?.value !== undefined) {
      field.value = value;

      // After applying a medium change, run the feed-medium conflict resolver
      // immediately so any open conflict can be marked resolved when the
      // source/target become compatible again.
      if ((key === "inputMedium" || key === "outputMedium") && (selectedComponent as any).type?.value === "equipment") {
        try {
          resolveFeedMediumConflicts(graph as any, userId ?? "system");
        } catch (e) {}
      }
    }
  }, [selectedComponent, graph, userId]);

  if (!selectedComponent) return null;

  return (
    <div
      className={`attr-sidebar-shell ${isCollapsed ? "collapsed" : "expanded"}`}
    >
      <button
        className="attr-toggle"
        onClick={() => setIsCollapsed(v => !v)}
        title={isCollapsed ? "Open" : "Collapse"}
      >
        {isCollapsed ? <FaChevronLeft /> : <FaChevronRight />}
      </button>

      <div className="attr-sidebar-inner">
        <div className="attr-header">
          <h3 className="attr-header-title">Component Details</h3>
          {onClose && (
            <button className="attr-close" onClick={onClose}>
              <FaTimes />
            </button>
          )}
        </div>

        {isReadOnly && (
          <div className="attr-lock-banner">
            🔒 Attributes locked by {lockedBy || "another user"}
          </div>
        )}

        <div className="attr-scroll">
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

          <div className="attr-card">
            <div className="attr-section-title">Attributes</div>

            {schema.map((def) => {
              const value = (selectedComponent as any)[def.key]?.value;

              // unit fields store a companion `${key}Unit` CVar (added to CEquipment/CPort)
              const unitValue = def.kind === "unit" ? (selectedComponent as any)[`${def.key}Unit`]?.value : undefined;

              // dynamic unit options for capacity depending on medium
              let defForRow = def as any;
              if (def.key === "capacity" && type === "port") {
                const mediumValue = (selectedComponent as any)["medium"]?.value;
                defForRow = { ...defForRow, unitOptions: capacityUnitOptionsFor(mediumValue) };
              }

              const onUnitChange = defForRow.kind === "unit" ? (newUnit: string) => {
                const u = (selectedComponent as any)[`${def.key}Unit`];
                if (u && typeof u === "object" && "value" in u) u.value = newUnit;
              } : undefined;

              return (
                <AttributeRow
                  key={def.key}
                  def={defForRow}
                  value={value}
                  unitValue={unitValue}
                  disabled={isReadOnly}
                  onChange={(val) => setVar(def.key, val)}
                  onUnitChange={onUnitChange}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
