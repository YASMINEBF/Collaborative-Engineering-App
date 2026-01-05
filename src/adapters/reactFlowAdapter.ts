// src/adapters/reactFlowAdapter.ts
import type { Edge, Node } from "reactflow";
import type { RelationshipKind } from "../models/relationships/enums/RelationshipTypes";
import type { Medium } from "../models/attributes/enums/Medium";

/**
 * Minimal "Collabs-like variable" shape:
 * Some fields are plain values, others are wrapped as { value: T }.
 */
export type CVarLike<T> = { value: T };

/* =========================
   Components → Nodes
   ========================= */

export type CComponentLike = {
  id: CVarLike<string> | string;

  // In your model: "equipment" | "port"
  type?: CVarLike<string> | string;

  uniqueName?: CVarLike<string> | string;
  title?: CVarLike<string> | string;

  position?: CVarLike<{ x: number; y: number }> | { x: number; y: number };
};

/* =========================
   Relationships → Edges
   ========================= */

export type CRelationshipLike = {
  id: CVarLike<string> | string;

  // In your model these are required
  sourceId: CVarLike<string> | string;
  targetId: CVarLike<string> | string;

  kind?: CVarLike<RelationshipKind> | RelationshipKind;
  medium?: CVarLike<Medium | null> | (Medium | null);

  // optional, if you store it
  type?: CVarLike<string> | string;
};

/**
 * Graph shape the adapter can understand.
 * Collabs collections vary in iteration API.
 */
export type CEngineeringGraphLike = {
  components: any;
  relationships?: any;
};

/**
 * Read either a Collabs-like var ({value}) or a plain value.
 * If v is undefined/null, return fallback.
 */
function readVar<T>(v: unknown, fallback: T): T {
  if (v && typeof v === "object" && "value" in (v as any)) {
    return (v as any).value as T;
  }
  if (v !== undefined && v !== null) return v as T;
  return fallback;
}

type ReactFlowNodeType = "equipment" | "port";
function normalizeNodeType(raw: string): ReactFlowNodeType {
  const t = (raw || "").trim().toLowerCase();
  if (t === "port") return "port";
  return "equipment";
}

/**
 * Try to iterate values from a Collabs CMap-like collection.
 */
function valuesOf<T>(collection: any): Iterable<T> {
  if (!collection) return [];

  if (typeof collection.values === "function") return collection.values();
  if (collection[Symbol.iterator]) return collection as Iterable<T>;

  if (typeof collection.forEach === "function") {
    const arr: T[] = [];
    collection.forEach((v: T) => arr.push(v));
    return arr;
  }

  return [];
}

/**
 * Convert ONE component into a React Flow node.
 */
export function cComponentToReactFlowNode(c: CComponentLike): Node | null {
  const id = String(readVar<string>((c as any).id, "")).trim();
  if (!id) return null;

  const rawType = String(readVar<string>((c as any).type, "equipment"));
  const nodeType: ReactFlowNodeType = normalizeNodeType(rawType);

  const label = String(
    readVar<string>(
      (c as any).uniqueName,
      readVar<string>((c as any).title, id)
    )
  );

  const pos = readVar<{ x: number; y: number }>((c as any).position, { x: 0, y: 0 });

  return {
    id,
    type: nodeType,
    position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
    data: {
      label,
      componentType: rawType,

      // UI defaults (optional)
      collaboratorSelection: undefined,
      lockInfo: {
        isLocked: false,
        lockedBy: null,
        canInteract: true,
        color: null,
      },
    },
  };
}

/**
 * Convert ONE relationship into a React Flow edge.
 */
export function cRelationshipToReactFlowEdge(r: CRelationshipLike): Edge | null {
  const id = String(readVar<string>((r as any).id, "")).trim();
  if (!id) return null;

  const source = String(readVar<string>((r as any).sourceId, "")).trim();
  const target = String(readVar<string>((r as any).targetId, "")).trim();
  if (!source || !target) return null;

  const kind = readVar<RelationshipKind | string>((r as any).kind, "controls" as any);
  const medium = readVar<Medium | null>((r as any).medium, null);

  return {
    id,
    source,
    target,
    type: "default",
    label: String(kind), // optional (remove if you don't want labels)
    data: {
      kind,
      medium,
    },
  };
}

/**
 * Convert the collaborative graph into React Flow nodes.
 */
export function graphToReactFlowNodes(graph: CEngineeringGraphLike): Node[] {
  const nodes: Node[] = [];
  if (!graph) return nodes;

  for (const c of valuesOf<CComponentLike>(graph.components)) {
    const node = cComponentToReactFlowNode(c);
    if (node) nodes.push(node);
  }

  return nodes;
}

/**
 * Convert the collaborative graph into React Flow edges.
 */
export function graphToReactFlowEdges(graph: CEngineeringGraphLike): Edge[] {
  const edges: Edge[] = [];
  if (!graph || !graph.relationships) return edges;

  for (const r of valuesOf<CRelationshipLike>(graph.relationships)) {
    const edge = cRelationshipToReactFlowEdge(r);
    if (edge) edges.push(edge);
  }

  return edges;
}
