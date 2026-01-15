// src/io/graphFile.ts
import type { CEngineeringGraph } from "../collabs/model/CEngineeringGraph";
import { Medium } from "../models/attributes/enums/Medium";
import { PortType } from "../models/attributes/enums/PortType";
import { Color } from "../models/attributes/enums/Color";
import { PhysicalKind } from "../models/relationships/enums/RelationshipTypes";
import type { RelationshipKind } from "../models/relationships/enums/RelationshipTypes";

// ✅ use your existing commands if you have them
import { createEquipment } from "../collabs/commands/equipment";
import { createPort } from "../collabs/commands/ports";
import { createRelationship, deleteRelationshipsForComponent } from "../collabs/commands/relationships";
import { deleteComponent, setComponentPosition } from "../collabs/commands/components";

// --------------------
// File schema (v1)
// --------------------
export type GraphFileV1 = {
  version: 1;
  meta?: { exportedAt?: number; name?: string };
  nodes: Array<{
    id: string;
    type: "equipment" | "port";
    name: string;
    position?: { x: number; y: number };
    attrs?: Record<string, any>;
  }>;
  edges: Array<{
    id: string;
    kind: RelationshipKind | string; // allow raw strings
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    medium?: Medium | null;
  }>;
};

// --------------------
// Helpers
// --------------------
function safeStr(x: any, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}
function safeNum(x: any, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
function safeObj(x: any): any {
  return x && typeof x === "object" ? x : {};
}

function normalizeKind(k: any): RelationshipKind {
  // Your enums are string enums; ReactFlow uses lowercase strings like "feeds"
  const s = String(k ?? "").trim();
  return s as any;
}

function isMedium(v: any): v is Medium {
  return Object.values(Medium as any).includes(v);
}
function isColor(v: any): v is Color {
  return Object.values(Color as any).includes(v);
}
function isPortType(v: any): v is PortType {
  return Object.values(PortType as any).includes(v);
}

// --------------------
// Export: Collabs -> JSON object
// --------------------
export function exportGraphToFile(graph: CEngineeringGraph): GraphFileV1 {
  const nodes: GraphFileV1["nodes"] = [];
  const edges: GraphFileV1["edges"] = [];

  for (const c of graph.components.values()) {
    const id = c.id.value;
    const type = c.type.value as "equipment" | "port";
    const name = c.uniqueName.value || id;

    nodes.push({
      id,
      type,
      name,
      position: c.position?.value ? { ...c.position.value } : { x: 0, y: 0 },
      attrs: {
        description: c.description?.value ?? "",
        ...(type === "equipment"
          ? {
              width: (c as any).width?.value ?? 0,
              height: (c as any).height?.value ?? 0,
              color: (c as any).color?.value ?? Color.Red,
              inputMedium: (c as any).inputMedium?.value ?? Medium.Water,
              outputMedium: (c as any).outputMedium?.value ?? Medium.Water,
            }
          : {
              portType: (c as any).portType?.value ?? PortType.Input,
              capacity: (c as any).capacity?.value ?? 0,
              medium: (c as any).medium?.value ?? Medium.Water,
            }),
      },
    });
  }

  for (const r of graph.relationships.values()) {
    edges.push({
      id: r.id.value,
      kind: r.kind.value as any,
      source: r.sourceId.value,
      target: r.targetId.value,
      sourceHandle: (r as any).sourceHandle?.value ?? null,
      targetHandle: (r as any).targetHandle?.value ?? null,
      medium: r.medium?.value ?? null,
    });
  }

  return {
    version: 1,
    meta: { exportedAt: Date.now() },
    nodes,
    edges,
  };
}

// --------------------
// Parse: string -> GraphFileV1 (validated + normalized)
// --------------------
export function parseGraphFile(jsonText: string): GraphFileV1 {
  const raw = JSON.parse(jsonText);

  if (!raw || raw.version !== 1) {
    throw new Error("Unsupported file format (expected version: 1).");
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error("Invalid file format: nodes/edges must be arrays.");
  }

  const nodes: GraphFileV1["nodes"] = raw.nodes.map((n: any) => {
    const type = n.type === "port" ? "port" : "equipment";
    const pos = safeObj(n.position);
    return {
      id: safeStr(n.id),
      type,
      name: safeStr(n.name),
      position: { x: safeNum(pos.x, 0), y: safeNum(pos.y, 0) },
      attrs: safeObj(n.attrs),
    };
  });

  const edges: GraphFileV1["edges"] = raw.edges.map((e: any) => ({
    id: safeStr(e.id),
    kind: normalizeKind(e.kind),
    source: safeStr(e.source),
    target: safeStr(e.target),
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    medium: e.medium ?? null,
  }));

  // basic validation
  for (const n of nodes) {
    if (!n.id || !n.name) throw new Error("Invalid node: id and name are required.");
  }
  for (const e of edges) {
    if (!e.id || !e.source || !e.target) throw new Error("Invalid edge: id/source/target required.");
  }

  return { version: 1, meta: safeObj(raw.meta), nodes, edges };
}

// --------------------
// Import: GraphFileV1 -> Collabs graph
// --------------------
export function importGraphFileIntoCollabs(graph: CEngineeringGraph, file: GraphFileV1, opts?: { wipe?: boolean }) {
  const wipe = opts?.wipe ?? false;

  // Wipe existing (simple + safe)
  if (wipe) {
    // delete relationships first
    const relIds = Array.from(graph.relationships.keys());
    for (const id of relIds) graph.relationships.delete(id);

    const compIds = Array.from(graph.components.keys());
    for (const id of compIds) deleteComponent(graph, id);
  }

  // 1) create nodes
  for (const n of file.nodes) {
    const id = n.id;
    const name = n.name || id;

    if (n.type === "equipment") {
      if (!graph.components.get(id)) createEquipment(graph, id, name);
      const c = graph.components.get(id) as any;
      if (!c) continue;

      // attrs (best effort)
      const a = n.attrs ?? {};
      if (typeof a.description === "string") c.description.value = a.description;

      if (typeof a.width === "number") c.width.value = a.width;
      if (typeof a.height === "number") c.height.value = a.height;
      if (isColor(a.color)) c.color.value = a.color;

      if (isMedium(a.inputMedium)) c.inputMedium.value = a.inputMedium;
      if (isMedium(a.outputMedium)) c.outputMedium.value = a.outputMedium;
    } else {
      if (!graph.components.get(id)) createPort(graph, id, name);
      const c = graph.components.get(id) as any;
      if (!c) continue;

      const a = n.attrs ?? {};
      if (typeof a.description === "string") c.description.value = a.description;

      if (isPortType(a.portType)) c.portType.value = a.portType;
      if (typeof a.capacity === "number") c.capacity.value = a.capacity;
      if (isMedium(a.medium)) c.medium.value = a.medium;
    }

    // position
    if (n.position) setComponentPosition(graph, id, n.position);
  }

  // 2) create edges (only if endpoints exist)
  for (const e of file.edges) {
    if (!graph.components.get(e.source) || !graph.components.get(e.target)) continue;

    // Medium: prefer explicit e.medium. If missing and kind=feeds, derive from source.outputMedium.
    let medium: Medium | null = (e.medium as any) ?? null;
    const kindStr = String(e.kind).toLowerCase();

    if (kindStr === String(PhysicalKind.Feeds).toLowerCase() && !medium) {
      const src = graph.components.get(e.source) as any;
      medium = src?.outputMedium?.value ?? null;
    }

    createRelationship(
      graph,
      e.id,
      e.kind as any,
      e.source,
      e.target,
      medium,
      e.sourceHandle ?? null,
      e.targetHandle ?? null
    );
  }
}

// --------------------
// Browser helpers (download/upload)
// --------------------
export function downloadGraphFile(file: GraphFileV1, filename = "graph.json") {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readFileAsText(f: File): Promise<string> {
  return await f.text();
}
