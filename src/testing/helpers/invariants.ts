import { PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";

/** Returns array of mismatches for Feed Medium Compatibility (Invariant #8). */
export function findFeedMediumMismatches(graph: any) {
  const mismatches: Array<{
    relId: string;
    aId: string;
    bId: string;
    aOut: any;
    bIn: any;
  }> = [];

  try {
    for (const r of graph.relationships.values()) {
      const kind = r.kind?.value ?? r.kind;
      if (kind !== PhysicalKind.Feeds && String(kind).toLowerCase() !== "feeds") continue;

      const relId = String(r.id?.value ?? r.id);
      const aId = String(r.sourceId?.value ?? r.sourceId);
      const bId = String(r.targetId?.value ?? r.targetId);

      const A = graph.components.get(aId);
      const B = graph.components.get(bId);
      if (!A || !B) continue; // dangling handled elsewhere

      const aOut = A.outputMedium?.value ?? A.outputMedium;
      const bIn = B.inputMedium?.value ?? B.inputMedium;

      if (aOut !== bIn) mismatches.push({ relId, aId, bId, aOut, bIn });
    }
  } catch (e) {}

  return mismatches;
}

export function getOpenConflictsByKind(graph: any, kind: any) {
  const out: Array<{ id: string; refs: string[]; winning: any; losing: any }> = [];
  if (!graph.conflicts?.entries) return out;

  try {
    for (const [id, c] of graph.conflicts.entries()) {
      const k = c.kind?.value ?? c.kind;
      if (k !== kind) continue;
      if ((c.status?.value ?? "open") !== "open") continue;
      const refs = c.entityRefs?.values ? Array.from(c.entityRefs.values()).map(String) : [];
      out.push({
        id: String(id),
        refs,
        winning: c.winningValue?.value ?? null,
        losing: c.losingValues?.value ?? null,
      });
    }
  } catch (e) {}

  return out;
}
