import { Medium } from "../../models/attributes/enums/Medium";
import { PortType } from "../../models/attributes/enums/PortType";
import { Color } from "../../models/attributes/enums/Color";
import { Unit } from "../../models/attributes/enums/Unit";

export type AttrKind = "text" | "number" | "enum" | "unit";

export type EnumOption = { value: string; label: string };

export type AttrDef =
  | { key: string; label: string; kind: "text" }
  | { key: string; label: string; kind: "number" }
  | { key: string; label: string; kind: "enum"; options: EnumOption[] }
  | { key: string; label: string; kind: "unit"; unitOptions: EnumOption[] }; // value is number-ish

// helper: build options from TS enums (string enums)
function enumOptionsFrom<E extends Record<string, string>>(e: E): EnumOption[] {
  return Object.values(e).map((v) => ({ value: v, label: v }));
}

// Unit example (used by equipment width/height)
export const defaultUnitOptions: EnumOption[] = [
  { value: "mm", label: "mm" },
  { value: "cm", label: "cm" },
  { value: "m", label: "m" },
];

export const equipmentAttributes: AttrDef[] = [
  { key: "uniqueName", label: "Name", kind: "text" },
  { key: "width", label: "Width", kind: "unit", unitOptions: defaultUnitOptions },
  { key: "height", label: "Height", kind: "unit", unitOptions: defaultUnitOptions },
  { key: "color", label: "Color", kind: "enum", options: enumOptionsFrom(Color) },
  { key: "inputMedium", label: "Input Medium", kind: "enum", options: enumOptionsFrom(Medium) },
  { key: "outputMedium", label: "Output Medium", kind: "enum", options: enumOptionsFrom(Medium) },
];

export const portAttributes: AttrDef[] = [
  { key: "uniqueName", label: "Name", kind: "text" },
  { key: "portType", label: "Port Type", kind: "enum", options: enumOptionsFrom(PortType) },
  { key: "capacity", label: "Capacity", kind: "unit", unitOptions: defaultUnitOptions },
  { key: "medium", label: "Medium", kind: "enum", options: enumOptionsFrom(Medium) },
];

// Provide capacity unit options depending on the medium
export function capacityUnitOptionsFor(medium?: Medium): EnumOption[] {
  switch (medium) {
    case Medium.Water:
      return [Unit.LPM, Unit.GPM].map((u) => ({ value: u, label: u }));
    case Medium.Air:
    case Medium.Gas:
      return [Unit.CFM, Unit.SCFM].map((u) => ({ value: u, label: u }));
    case Medium.Electricity:
      return [Unit.Amps, Unit.Volts].map((u) => ({ value: u, label: u }));
    case Medium.Chemical:
      return [Unit.LPM, Unit.GPM].map((u) => ({ value: u, label: u }));
    case Medium.Signal:
      return [Unit.Hertz, Unit.Decibels].map((u) => ({ value: u, label: u }));
    default:
      return defaultUnitOptions;
  }
}

// Unit example (if you add unit-based attributes later):
// (defaultUnitOptions declared above)
