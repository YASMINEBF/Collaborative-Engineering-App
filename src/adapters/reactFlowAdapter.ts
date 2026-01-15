// src/adapters/reactFlowAdapter.ts
import type { Edge, Node } from "reactflow";
import { MarkerType } from "reactflow";
import { LogicalKind, type RelationshipKind } from "../models/relationships/enums/RelationshipTypes";
import type { Medium } from "../models/attributes/enums/Medium";
import { ConflictKind } from "../collabs/model/enums/ConflictEnum";

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

  // Optional media values (may be stored as CVar or plain)
  inputMedium?: CVarLike<Medium> | Medium;
  outputMedium?: CVarLike<Medium> | Medium;

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
  conflicts?: any;
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

  const kind = readVar<RelationshipKind>((r as any).kind, LogicalKind.Controls);
  const kindClass = String(kind).toLowerCase();

  const sourceHandle = readVar<string | null>((r as any).sourceHandle, null);
  const targetHandle = readVar<string | null>((r as any).targetHandle, null);

  // ✅ read medium from the relationship
  const medium = readVar<Medium | null>((r as any).medium, null);

    // ✅ label: "feeds (Water)" only for feeds
    const label =
      kindClass === "feeds" && medium
        ? `feeds (${String(medium)})`
        : String(kind);

  // ✅ Calculate offset for bidirectional edges
  const needsOffset =
    source > target ||
    (source === target && (sourceHandle || "") > (targetHandle || ""));
  const offset = needsOffset ? 20 : -20;

  return {
    id,
    source,
    target,
    type: "smoothstep",
    className: `edge-${kindClass}`,
    markerEnd: { type: MarkerType.ArrowClosed },

    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),

    data: {
      offset,
      // (optional but nice to have in UI)
      kind,
      medium,
    },

    label,

    labelStyle: {
      fill: "#333",
      fontWeight: 600,
      fontSize: 12,
    },
    labelBgStyle: {
      fill: "white",
      fillOpacity: 0.9,
    },
    labelBgPadding: [8, 4] as [number, number],
    labelBgBorderRadius: 4,
  };
}

/**
 * Convert the collaborative graph into React Flow nodes.
 */
export function graphToReactFlowNodes(graph: CEngineeringGraphLike): Node[] {
  const nodes: Node[] = [];
  if (!graph) return nodes;

  // Gather conflict entity refs for feed-medium mismatches
  const conflictIds = new Set<string>();
  try {
    if (graph.conflicts) {
      for (const c of valuesOf<any>(graph.conflicts)) {
        try {
          // Highlight feed-medium mismatches and cycle-detected conflicts
          if (
            c.kind?.value !== ConflictKind.FeedMediumMismatch &&
            c.kind?.value !== ConflictKind.CycleDetected
          )
            continue;
          // Only consider open conflicts for highlighting
          if ((c.status?.value ?? "open") !== "open") continue;
          for (const ref of c.entityRefs?.values ? c.entityRefs.values() : []) conflictIds.add(String(ref));
        } catch {}
      }
    }
  } catch {}

  for (const c of valuesOf<CComponentLike>(graph.components)) {
    const node = cComponentToReactFlowNode(c);
    if (node) nodes.push(node);
  }

  // Apply conflict className to nodes whose id is referenced by a FeedMediumMismatch
  return nodes.map((n) => ({
    ...n,
    className: conflictIds.has(n.id) ? `${n.className ?? ""} node-conflict`.trim() : n.className,
    data: { ...(n.data ?? {}), conflict: conflictIds.has(n.id) },
  }));
}

/**
 * Convert the collaborative graph into React Flow edges.
 */
export function graphToReactFlowEdges(graph: CEngineeringGraphLike): Edge[] {
  const edges: Edge[] = [];
  if (!graph || !graph.relationships) return edges;

  for (const r of valuesOf<CRelationshipLike>(graph.relationships)) {
    const edge = cRelationshipToReactFlowEdge(r);
    if (!edge) continue;

    // If feeds edge has no explicit medium, try to derive from components
    if ((edge.className || "").includes("feeds") && !edge.data?.medium) {
      try {
        const srcId = String((r as any)?.sourceId?.value ?? (r as any)?.sourceId ?? "");
        const tgtId = String((r as any)?.targetId?.value ?? (r as any)?.targetId ?? "");
        const src = graph.components?.get ? graph.components.get(srcId) : (graph.components ? graph.components[srcId] : undefined);
        const tgt = graph.components?.get ? graph.components.get(tgtId) : (graph.components ? graph.components[tgtId] : undefined);
        const srcOut = src ? readVar((src as any).outputMedium, null) : null;
        const tgtIn = tgt ? readVar((tgt as any).inputMedium, null) : null;
        const derived = srcOut ?? tgtIn ?? null;
        if (derived) {
          const mediumLabel = String(derived);
          edge.label = `${String(edge.label)} (${mediumLabel})`;
          edge.data = { ...(edge.data ?? {}), medium: derived };
        }
      } catch (e) {
        // ignore
      }
    }

    edges.push(edge);
  }

  // Post-process edges to mark conflicts based on graph.conflicts
    try {
      const conflictIds = new Set<string>();
      if (graph.conflicts) {
        for (const c of valuesOf<any>(graph.conflicts)) {
          try {
            if (
              c.kind?.value !== ConflictKind.FeedMediumMismatch &&
              c.kind?.value !== ConflictKind.CycleDetected
            )
              continue;
            if ((c.status?.value ?? "open") !== "open") continue;
            for (const ref of c.entityRefs?.values ? c.entityRefs.values() : []) conflictIds.add(String(ref));
          } catch {}
        }
      }

      return edges.map((e) => ({
        ...e,
        className: conflictIds.has(e.id) ? `${e.className ?? ""} conflict`.trim() : e.className,
        data: { ...(e.data ?? {}), conflict: conflictIds.has(e.id) },
        labelStyle: conflictIds.has(e.id)
          ? { ...(e.labelStyle ?? {}), fill: "#a00" }
          : e.labelStyle,
      }));
    } catch (e) {
      return edges;
    }

  return edges;
}
