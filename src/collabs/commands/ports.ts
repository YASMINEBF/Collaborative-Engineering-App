// collabs/commands/ports.ts
import type { CEngineeringGraph, ComponentId } from "../model/CEngineeringGraph";
import { createComponent } from "./components";
import { Medium } from "../../models/attributes/enums/Medium";
import { PortType } from "../../models/attributes/enums/PortType";
import CPort from "../model/CPort";

function asPort(graph: CEngineeringGraph, id: ComponentId): CPort | null {
  const c = graph.components.get(id);
  if (!c) return null;
  return c.type.value === "port" ? (c as CPort) : null;
}

export function createPort(graph: CEngineeringGraph, id: ComponentId, name: string) {
  createComponent(graph, id, "port", name);
}

export function setPortCapacity(graph: CEngineeringGraph, id: ComponentId, capacity: number) {
  const p = asPort(graph, id);
  if (!p) return;
  p.capacity.value = capacity;
}

export function setPortMedium(graph: CEngineeringGraph, id: ComponentId, medium: Medium) {
  const p = asPort(graph, id);
  if (!p) return;
  p.medium.value = medium;
}

export function setPortType(graph: CEngineeringGraph, id: ComponentId, portType: PortType) {
  const p = asPort(graph, id);
  if (!p) return;
  p.portType.value = portType;
}
