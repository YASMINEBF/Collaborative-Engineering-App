import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

type Pair = { value: number; unit: string };
type PairKey = "width" | "height";

const semanticKeyOf = (conf: any): string => {
  try {
    const k = conf?.winningValue?.value?.key;
    return typeof k === "string" ? k : "";
  } catch {
    return "";
  }
};

export function applyValueUnitPairResolution(
  graph: CEngineeringGraph,
  compId: string,
  key: PairKey,
  chosen: Pair,
  currentUserId = "system"
) {
  const comp: any = graph.components.get(compId as any);
  if (!comp) return false;

  const valueVar = key === "width" ? comp.width : comp.height;
  const unitVar  = key === "width" ? comp.widthUnit : comp.heightUnit;

  if (!valueVar || !unitVar) return false;

  // 1) Resolve the underlying MV-registers (REAL fix)
  try { valueVar.value = chosen.value; } catch {}
  try { unitVar.value = chosen.unit; } catch {}

  // 2) Mark only the matching CConflict resolved (bookkeeping)
  try {
    for (const [, conf] of graph.conflicts.entries()) {
      if (conf.kind?.value !== ConflictKind.SemanticallyRelatedAttributes) continue;

      const refs = conf.entityRefs?.values ? Array.from(conf.entityRefs.values()) : [];
      if (!refs.includes(String(compId))) continue;

      const confKey = semanticKeyOf(conf);
      if (confKey !== key) continue; // IMPORTANT: only this pair

      conf.winningValue.value = { key, chosenValue: chosen };
      conf.status.value = "resolved";
      conf.createdBy.value = currentUserId;
      conf.createdAt.value = Date.now();
    }
  } catch {}

  return true;
}
