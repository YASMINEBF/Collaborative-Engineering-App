// collabs/commands/equipment.ts
import type { CEngineeringGraph, ComponentId } from "../model/CEngineeringGraph";
import { createComponent } from "./components";
import { Color } from "../../models/attributes/enums/Color";
import { Medium } from "../../models/attributes/enums/Medium";
import CEquipment from "../model/CEquipment";

/** Type guard helper */
function asEquipment(graph: CEngineeringGraph, id: ComponentId): CEquipment | null {
  const c = graph.components.get(id);
  if (!c) return null;
  return c.type.value === "equipment" ? (c as CEquipment) : null;
}

export function createEquipment(graph: CEngineeringGraph, id: ComponentId, name: string, createdBy?: string) {
  createComponent(graph, id, "equipment", name, createdBy);
}

export function setEquipmentSize(graph: CEngineeringGraph, id: ComponentId, w: number, h: number) {
  const eq = asEquipment(graph, id);
  if (!eq) return;
  eq.width.value = w;
  eq.height.value = h;
}

export function setEquipmentColor(graph: CEngineeringGraph, id: ComponentId, color: Color) {
  const eq = asEquipment(graph, id);
  if (!eq) return;
  eq.color.value = color;
}

export function setEquipmentMedia(graph: CEngineeringGraph, id: ComponentId, input: Medium, output: Medium) {
  const eq = asEquipment(graph, id);
  if (!eq) return;
  eq.inputMedium.value = input;
  eq.outputMedium.value = output;
}
