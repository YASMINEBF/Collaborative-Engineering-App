# Semantic Resolvers - CRDT Mechanisms

This document describes how each semantic invariant is enforced using CRDTs.

## Summary Table

| Invariant | CRDT / Data Structure | How It's Solved |
|-----------|----------------------|-----------------|
| **Unique Names** | `nameIndex: CValueMap<name, componentId>` | Iterate `components`, detect duplicates via `nameIndex.get(name)`. Winner = lexicographically smallest component ID (`ids.sort()[0]`). Loser gets renamed, `nameIndex.set(newName, loserId)`. |
| **Feed Medium Conflicts** | `feedsByPortMedium: CValueMap<portId::medium, relId>` | One feed per (port, medium). If duplicate found in `feedsByPortMedium`, edge is highlighted. User chooses to update the medium or delete the edge. |
| **HasPart Cycles** | `parentByChild: CValueMap<childId, parentId>` | Walk `parentByChild` to detect cycles. If cycle found, delete the edge that closes it. |
| **Value/Unit Conflicts** | `attrs: CValueMap<key, value>` + `attrs.getConflicts(key)` | Call `.getConflicts(key)` → returns `V[]` of concurrent values. If `length > 1`, create `CConflict`. User picks winner → `attrs.set(key, chosen)`. |
| **Dangling References** | `deletionLog: CValueMap<componentId, DeletionRecord>` | Edge references missing node → check `deletionLog.get(id)`. If found, resurrect as tombstone via `components.set()`. Creates **ONE conflict per node** (not per edge): conflict ID = `dangling::node::{nodeId}`. Resurrected edges use deterministic IDs: `{src}::{tgt}::{kind}`. After `keepBoth` clears tombstone, `isTombstone()` returns false → no new conflicts. |

## Key Insight

All resolvers use `CValueMap` indices that act as a **single source of truth** for constraints. Conflicts are resolved by:

1. Reading current CRDT state
2. Applying domain-specific rules (earliest wins, delete duplicate, etc.)
3. Writing back to the CRDT (which propagates to all replicas)

## Files

- `resolveUniqueNames.ts` - Unique name enforcement
- `resolveFeedMediumConflicts.ts` - One feed per (port, medium)
- `resolveHasPartCycles.ts` - No cycles in HasPart hierarchy
- `resolveValueUnitConflicts.ts` - Concurrent attribute edit detection
- `resolveDanglingReferences.ts` - Tombstone resurrection for dangling edges
