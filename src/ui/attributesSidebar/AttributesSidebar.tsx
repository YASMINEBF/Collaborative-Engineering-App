import { useEffect, useMemo, useState, useCallback } from "react";
import { FaChevronLeft, FaChevronRight, FaTimes } from "react-icons/fa";
import { useCollab } from "../../collabs/provider/CollabProvider";
import AttributeRow from "./AttributeRow";
import {
  equipmentAttributes,
  portAttributes,
  capacityUnitOptionsFor,
} from "./attributeSchema";
import { validateAndNotifyIfBlocked } from "../../collabs/semantics/mediaChangeValidator";
import resolveFeedMediumConflicts from "../../collabs/semantics/resolveFeedMediumConflicts";
import resolveValueUnitConflicts from "../../collabs/semantics/resolveValueUnitConflicts";
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

  // Rerender on doc changes
  useEffect(() => {
    if (!doc || status !== "ready") return;
    const onChange = () => setTick((t) => t + 1);
    doc.on?.("Change", onChange);
    return () => doc.off?.("Change", onChange);
  }, [doc, status]);

  const type = selectedComponent?.type?.value ?? null;
  const schema =
    type === "equipment"
      ? equipmentAttributes
      : type === "port"
      ? portAttributes
      : [];

  /**
   * Run changes inside a single Collabs transaction when supported.
   * This avoids "half states" (value without unit etc.) in the CRDT history.
   */
  const transact = useCallback(
    (fn: () => void) => {
      if (doc && typeof (doc as any).transact === "function") {
        (doc as any).transact(fn);
      } else {
        fn();
      }
    },
    [doc]
  );

  /**
   * Canonical key used by the resolver for value+unit pairs.
   * (This MUST match what your resolver scans.)
   */
  const valueUnitKey = useCallback((k: string) => `pair:valueUnit:${k}`, []);

  const setVar = useCallback(
    (key: string, value: any) => {
      if (!selectedComponent || !graph) return;

      // Validate equipment medium changes against feeds edges
      if (
        (key === "inputMedium" || key === "outputMedium") &&
        (selectedComponent as any).type?.value === "equipment"
      ) {
        try {
          const newInput =
            key === "inputMedium"
              ? value
              : (selectedComponent as any)["inputMedium"]?.value;
          const newOutput =
            key === "outputMedium"
              ? value
              : (selectedComponent as any)["outputMedium"]?.value;

          const allowed = validateAndNotifyIfBlocked(
            graph as any,
            (selectedComponent as any).id?.value ?? (selectedComponent as any).id,
            newInput,
            newOutput
          );
          if (!allowed) return;
        } catch {
          // ignore; fall back to direct set
        }
      }

      const field = (selectedComponent as any)[key];
      if (!field || typeof field !== "object" || !("value" in field)) return;

      const attrs: any = (selectedComponent as any).attrs;

      transact(() => {
        // 1) Update the real CVar
        field.value = value;

        // 2) value+unit semantic pair -> attrs MV-register
        // Only if there's a companion Unit CVar
        const unitVar = (selectedComponent as any)[`${key}Unit`];
        if (
          attrs &&
          typeof attrs.set === "function" &&
          unitVar &&
          typeof unitVar === "object" &&
          "value" in unitVar
        ) {
          attrs.set(valueUnitKey(key), { value, unit: unitVar.value });
        }

        // 3) name+description semantic pair
        if (attrs && typeof attrs.set === "function") {
          if (key === "uniqueName" || key === "name" || key === "description") {
            const nameVar =
              (selectedComponent as any)["uniqueName"] ||
              (selectedComponent as any)["name"];
            const descVar = (selectedComponent as any)["description"];

            const name =
              key === "uniqueName" || key === "name" ? value : nameVar?.value ?? "";
            const description =
              key === "description" ? value : descVar?.value ?? "";

            // Keep your existing key so your working resolver keeps working
            attrs.set("pair:nameDesc", { name, description });
          }
        }

        // 4) width+height bundled (optional but helps your width/height resolver)
        if (attrs && typeof attrs.set === "function") {
          if (key === "width" || key === "height") {
            const w =
              key === "width" ? value : (selectedComponent as any).width?.value;
            const h =
              key === "height" ? value : (selectedComponent as any).height?.value;
            const unit = (selectedComponent as any).widthUnit?.value ?? "mm";
            attrs.set("pair:dims", { width: w, height: h, unit });
          }
        }
      });

      // Run semantic conflict detection after the transaction
      try {
        resolveValueUnitConflicts(graph as any, userId ?? "system");
      } catch {}

      // Run feed-medium resolver after medium changes
      if (
        (key === "inputMedium" || key === "outputMedium") &&
        (selectedComponent as any).type?.value === "equipment"
      ) {
        try {
          resolveFeedMediumConflicts(graph as any, userId ?? "system");
        } catch {}
      }
    },
    [selectedComponent, graph, userId, transact, valueUnitKey]
  );

  if (!selectedComponent) return null;

  return (
    <div className={`attr-sidebar-shell ${isCollapsed ? "collapsed" : "expanded"}`}>
      <button
        className="attr-toggle"
        onClick={() => setIsCollapsed((v) => !v)}
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

              // Unit fields store a companion `${key}Unit` CVar
              const unitValue =
                def.kind === "unit"
                  ? (selectedComponent as any)[`${def.key}Unit`]?.value
                  : undefined;

              // Dynamic unit options for capacity depending on medium
              let defForRow = def as any;
              if (def.key === "capacity" && type === "port") {
                const mediumValue = (selectedComponent as any)["medium"]?.value;
                defForRow = {
                  ...defForRow,
                  unitOptions: capacityUnitOptionsFor(mediumValue),
                };
              }

              const onUnitChange =
                defForRow.kind === "unit"
                  ? (newUnit: string) => {
                      if (!graph) return;

                      const unitVar = (selectedComponent as any)[`${def.key}Unit`];
                      const attrs: any = (selectedComponent as any).attrs;

                      if (
                        !unitVar ||
                        typeof unitVar !== "object" ||
                        !("value" in unitVar)
                      )
                        return;

                      transact(() => {
                        // 1) Update the real unit CVar
                        unitVar.value = newUnit;

                        // 2) Write semantic value+unit pair into attrs MV-register
                        const valueVar = (selectedComponent as any)[def.key];
                        const currentValue =
                          valueVar && typeof valueVar === "object" && "value" in valueVar
                            ? valueVar.value
                            : undefined;

                        if (attrs && typeof attrs.set === "function") {
                          attrs.set(valueUnitKey(def.key), {
                            value: currentValue,
                            unit: newUnit,
                          });

                          // If this is width/height, also update the dims bundle unit
                          if (def.key === "width" || def.key === "height") {
                            const w = (selectedComponent as any).width?.value;
                            const h = (selectedComponent as any).height?.value;
                            attrs.set("pair:dims", { width: w, height: h, unit: newUnit });
                          }
                        }
                      });

                      try {
                        resolveValueUnitConflicts(graph as any, userId ?? "system");
                      } catch {}
                    }
                  : undefined;

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
