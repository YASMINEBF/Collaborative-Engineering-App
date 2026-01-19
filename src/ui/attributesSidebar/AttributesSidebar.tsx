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
      // If this attribute has a companion unit CVar, update both CVar and
      // also attempt to write a full {value, unit} pair into any MV-register
      // present on the component so resolvers can compare pairs.
      const companionUnit = (selectedComponent as any)[`${key}Unit`];
      const currentUnit = companionUnit && typeof companionUnit === "object" ? companionUnit.value : undefined;

      field.value = value;

      // Find an MV-like map on the component (CValueMap / CMultiValueMap)
      try {
        const compObj: any = selectedComponent as any;
        for (const p of Object.keys(compObj)) {
          try {
            const maybeMap = compObj[p];
            if (!maybeMap) continue;
            if (typeof maybeMap.getConflicts === "function" && typeof maybeMap.set === "function") {
              // Special-case width/height pair -> write to `_dims` key with both values
              if (key === "width" || key === "height") {
                const widthField = (selectedComponent as any)["width"];
                const heightField = (selectedComponent as any)["height"];
                const w = key === "width" ? value : widthField && typeof widthField === "object" ? widthField.value : undefined;
                const h = key === "height" ? value : heightField && typeof heightField === "object" ? heightField.value : undefined;
                const mapKey = "_dims";
                try {
                  maybeMap.set(mapKey, { width: w, height: h, unit: currentUnit });
                } catch (e) {}
                break;
              }

              // Special-case name/description pair -> write to `_nameDesc` key
              if (key === "uniqueName" || key === "description" || key === "name") {
                const nameField = (selectedComponent as any)["uniqueName"] || (selectedComponent as any)["name"];
                const descField = (selectedComponent as any)["description"];
                const n = key === "uniqueName" || key === "name" ? value : nameField && typeof nameField === "object" ? nameField.value : undefined;
                const d = key === "description" ? value : descField && typeof descField === "object" ? descField.value : undefined;
                const mapKey = "_nameDesc";
                try {
                  maybeMap.set(mapKey, { name: n, description: d });
                } catch (e) {}
                break;
              }

              // Default: per-attribute value+unit key
              const mapKey = typeof maybeMap.get === "function" ? `_valueUnit:${key}` : key;
              try {
                maybeMap.set(mapKey, { value, unit: currentUnit });
              } catch (e) {}
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}

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
                if (u && typeof u === "object" && "value" in u) {
                  // Update unit CVar
                  u.value = newUnit;

                  // Also attempt to write full pair into any MV-register on the component
                  try {
                    const compObj: any = selectedComponent as any;
                    const valueField = (selectedComponent as any)[def.key];
                    const currentValue = valueField && typeof valueField === "object" ? valueField.value : undefined;
                    for (const p of Object.keys(compObj)) {
                      try {
                        const maybeMap = compObj[p];
                        if (!maybeMap) continue;
                        if (typeof maybeMap.getConflicts === "function" && typeof maybeMap.set === "function") {
                          const mapKey = typeof maybeMap.get === "function" ? `_valueUnit:${def.key}` : def.key;
                          try {
                            maybeMap.set(mapKey, { value: currentValue, unit: newUnit });
                          } catch (e) {}
                          break;
                        }
                      } catch (e) {}
                    }
                  } catch (e) {}
                }
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
