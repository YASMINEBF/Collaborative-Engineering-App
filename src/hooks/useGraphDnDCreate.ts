// src/hooks/useGraphDnDCreate.ts
import { useCallback, useMemo, useState } from "react";
import { useCollab } from "../collabs/provider/CollabProvider";
import { createEquipment } from "../collabs/commands/equipment";
import { createPort } from "../collabs/commands/ports";
import { setComponentPosition } from "../collabs/commands/components";
import { PortType } from "../models";
import {setPortType} from "../collabs/commands/ports";

type PaletteType = "equipment" | "port";
type PendingDrop = { type: PaletteType; position: { x: number; y: number } };

export function useGraphDnDCreate() {
  const { graph, status, userId } = useCollab();
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const [error, setError] = useState<string>("");

  const canEdit = status === "ready" && !!graph;

  const showPortType = pending?.type === "port";


  const title = useMemo(() => {
    if (!pending) return "";
    return pending.type === "equipment" ? "Create Equipment" : "Create Port";
  }, [pending]);

  const openForDrop = useCallback(
    (type: PaletteType, position: { x: number; y: number }) => {
      if (!canEdit) return;
      setError("");
      setPending({ type, position });
    },
    [canEdit]
  );

  const cancel = useCallback(() => {
    setError("");
    setPending(null);
  }, []);

const confirm = useCallback(
  (payload: { name: string; portType?: PortType }) => {
    if (!pending || !canEdit || !graph) return;

    const id =
      pending.type === "equipment" ? `eq-${Date.now()}` : `port-${Date.now()}`;
    const finalName = payload.name.trim() || id;

    try {
      if (pending.type === "equipment") {
        createEquipment(graph, id, finalName, userId);
      } else {
        createPort(graph, id, finalName, userId);

        // ✅ apply chosen port type (only relevant for ports)
        if (payload.portType) setPortType(graph, id, payload.portType);
      }

      setComponentPosition(graph, id, pending.position);

      setError("");
      setPending(null);
    } catch (e: any) {
      setError(e?.message ?? "Could not create component.");
    }
  },
  [pending, canEdit, graph]
);

const clearError = useCallback(() => setError(""), []);

return { canEdit, pending, title, error, showPortType, clearError, openForDrop, cancel, confirm };
}

export default useGraphDnDCreate;