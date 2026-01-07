import type { CEngineeringGraph } from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Stable suffix so all replicas produce the same rename for the same component.
 */
function suffixFromId(id: string) {
  const cleaned = id.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.slice(-4) || id.slice(-4) || "xxxx";
}

function makeAutoName(base: string, id: string) {
  return `${base} (auto-${suffixFromId(id)})`;
}

function safeUserId(c: any): string {
  // If you add createdBy on components later, this will pick it up.
  // Otherwise it's "unknown".
  return (c?.createdBy?.value ?? "").trim() || "unknown";
}

/**
 * Resolves duplicate component names deterministically.
 *
 * Policy:
 * - Winner = lexicographically smallest component id (stable across replicas)
 * - Losers are auto-renamed deterministically: `${name} (auto-XXXX)`
 * - A DuplicateName conflict is recorded in graph.conflicts describing the decision.
 *
 * IMPORTANT:
 * Call this from a deferred task (setTimeout/queueMicrotask) after doc changes,
 * not during Collabs receive/load.
 */
export type RenameRecord = {
  conflictId: string;
  winnerId: string;
  winnerName: string;
  losingRecords: Array<{ id: string; oldName: string; newName: string; createdBy?: string }>;
};

/**
 * Resolves duplicate component names deterministically.
 *
 * Returns a list of rename/conflict summaries so callers (UI) can notify users.
 */
export function resolveUniqueNames(
  graph: CEngineeringGraph,
  currentUserId = "system"
): RenameRecord[] {
  // name -> list of ids
  const byName = new Map<string, string[]>();

  for (const c of graph.components.values()) {
    const name = (c.uniqueName?.value ?? "").trim();
    if (!name) continue;

    const id = String(c.id.value);
    const arr = byName.get(name) ?? [];
    arr.push(id);
    byName.set(name, arr);
  }

  const results: RenameRecord[] = [];

  for (const [name, ids] of byName) {
    if (ids.length <= 1) continue;

    ids.sort(); // deterministic
    const winnerId = ids[0];
    const winner = graph.components.get(winnerId);
    if (!winner) continue;

    // Ensure nameIndex points to the winner for the original name
    graph.nameIndex.set(name, winnerId);

    const losingRecords: Array<{
      id: string;
      oldName: string;
      newName: string;
      createdBy?: string;
    }> = [];

    for (const loserId of ids.slice(1)) {
      const loser = graph.components.get(loserId);
      if (!loser) continue;

      const oldName = (loser.uniqueName.value ?? "").trim();
      if (oldName !== name) continue; // already fixed elsewhere

      // Deterministic rename
      let newName = makeAutoName(name, loserId);

      // Rare collision: if that auto-name is already used by someone else, make it unique deterministically
      const existing = graph.nameIndex.get(newName);
      if (existing && existing !== loserId) {
        newName = `${name} (auto-${loserId})`;
      }

      // Apply rename
      loser.uniqueName.value = newName;

      // Maintain index
      graph.nameIndex.delete(oldName);
      graph.nameIndex.set(newName, loserId);

      losingRecords.push({
        id: loserId,
        oldName,
        newName,
        createdBy: safeUserId(loser),
      });
    }

    // If we didn't actually rename any, don't create noise
    if (losingRecords.length === 0) continue;

    // Record a conflict entry describing what happened
    const conflictId = `conf-dupname-${Date.now()}-${winnerId}`;

    graph.conflicts.set(conflictId, ConflictKind.DuplicateName);
    const conf = graph.conflicts.get(conflictId);
    if (!conf) continue;

    // Which entities are involved?
    conf.entityRefs.add(winnerId);
    for (const lr of losingRecords) conf.entityRefs.add(lr.id);

    // What value "won"?
    conf.winningValue.value = {
      name, // the base name that was duplicated
      winnerId,
      winnerCreatedBy: safeUserId(winner),
      keptName: name,
      rule: "winner = min(componentId)",
    };

    // What values lost / were changed?
    conf.losingValues.value = losingRecords;

    // metadata
    conf.createdBy.value = currentUserId;
    conf.createdAt.value = Date.now();
    conf.status.value = "resolved";

    results.push({
      conflictId,
      winnerId,
      winnerName: name,
      losingRecords,
    });
  }

  return results;
}
