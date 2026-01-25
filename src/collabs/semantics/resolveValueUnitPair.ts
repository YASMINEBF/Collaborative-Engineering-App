import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

type DimsPair = { width: number; height: number; unit: string };

const semanticKeyOf = (conf: any): string => {
  try {
    const k = conf?.winningValue?.value?.key;
    return typeof k === "string" ? k : "";
  } catch {
    return "";
  }
};

export function applyDimsPairResolution(
  graph: CEngineeringGraph,
  compId: string,
  chosen: DimsPair,
  currentUserId = "system"
) {
  const comp: any = graph.components.get(compId as any);
  if (!comp) return false;

  // 1) apply to the underlying CVars
  try { if (comp.width) comp.width.value = chosen.width; } catch {}
  try { if (comp.height) comp.height.value = chosen.height; } catch {}
  try {
    if (comp.widthUnit) comp.widthUnit.value = chosen.unit;
    if (comp.heightUnit) comp.heightUnit.value = chosen.unit;
  } catch {}

  // 2) apply to attrs MV-register (this is what actually resolves the MV conflicts)
  try {
    if (comp.attrs && typeof comp.attrs.set === "function") {
      comp.attrs.set("pair:dims", chosen);
    }
  } catch {}

  // 3) mark matching semantic conflict resolved (bookkeeping)
  const keyHint = "pair:dims";
  try {
    for (const [, conf] of graph.conflicts.entries()) {
      if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;

      const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
      if (!refs.includes(String(compId))) continue;

      if (semanticKeyOf(conf) !== keyHint) continue;

      conf.winningValue.value = { key: keyHint, chosenValue: chosen };
      conf.status.value = "resolved";
      conf.createdBy.value = currentUserId;
      conf.createdAt.value = Date.now();
    }
  } catch {}

  return true;
}
