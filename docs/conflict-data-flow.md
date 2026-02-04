# Conflict Data Flow — Collaborative Engineering App

## Overview
This document describes the end-to-end data flow for conflict detection, recording, notification, highlighting, and resolution across all app instances for the conflict types implemented in the codebase:

- Semantically-related attribute pairs: value + unit (per-attribute), dimensions (width + height), name + description
- Structural conflicts: `hasPart` cycles
- Domain rules: feed–medium incompatibility

The system uses Collabs CRDTs (CVar, CValueMap / CMultiValueMap, CObject) and a resolver orchestration that writes persistent conflict records into `graph.conflicts` (a CRDT map). UI notifications are delivered via both CRDT reads and immediate `ce:notification` events.

---

## High-level flow (common to all conflict types)

1. User Edit
   - The UI writes into Collabs-backed structures. For semantic pairs the UI prefers grouped MV keys (e.g., `_valueUnit:<attr>`, `_dims`, `_nameDesc`). Some UIs may write split fields (e.g., `Width` and `WidthUnit` separately).

2. CRDT Replication
   - Collabs records concurrent writes as multiple candidates in multi-value maps or multiple values across CVar/CObject. These candidates replicate to other clients.

3. Background Resolver (debounced)
   - Runs after document changes and scans components and their Collabs maps for keys/patterns of interest.
   - Normalizes candidate sets into semantic shapes (e.g., `{value,unit}`, `{width,height}`, `{name,description}`), including synthesizing pairs when value and unit are stored separately.
   - Applies conflict heuristics (see per-conflict rules below) and determines whether to write a persistent conflict record.

4. Conflict Recording
   - Resolver writes a CRDT entry into `graph.conflicts` with a generated id.
   - Typical fields set: `kind`, `entityRefs`, `losingValues`, `winningValue` (null if none), `createdBy`, `createdAt`, `status` (`open`).
   - Because `graph.conflicts` is a CRDT, the conflict record is replicated to all clients.

5. Notification Dispatch
   - Resolver dispatches a `ce:notification` DOM event with details (`compId`, `key`, human message) to ensure immediate, dedupable toasts in `NotificationCenter`.

6. UI Highlighting
   - Views read `graph.conflicts` and apply visual markers (attribute rows, edges/nodes) to highlight conflicts.

7. User Resolution
   - User selects a winning value in the UI; the resolution helper (`applyMVRegisterResolution` / `resolveMVRegister`) writes the chosen winner back into the appropriate MV key or pair of fields and updates the `graph.conflicts` entry (`winningValue`, `losingValues`, `status: resolved`). These writes are CRDTs and replicate to all clients.

8. Convergence
   - All replicas converge: conflict records and resolution writes ensure consistent highlights/notifications across apps.

---

## Per-conflict rules and behavior

### Value + Unit (per-attribute)
- Write patterns:
  - Preferred: `_valueUnit:<attr>` MV key containing `{ value, unit }`.
  - Alternate: two CVar fields: `<attr>` and `<attr>Unit`.
- Detection:
  - Resolver checks `_valueUnit:*` MV keys and synthesizes candidates by combining concurrent `<attr>` and `<attr>Unit` candidates when both exist.
  - Conflict rule: create a `SemanticallyRelatedAttributes` conflict only when at least one pairwise candidate comparison differs in BOTH `value` and `unit`. This prevents sequential edits from being flagged.
- Recording/UI:
  - `graph.conflicts` holds the conflict record; `losingValues` contains the conflicting pairs. Resolver dispatches `ce:notification` with `key` hint `_valueUnit:<attr>`.
  - `NotificationCenter` shows a toast; attribute row highlighted; resolution writes winner to MV or split fields.

### Dimensions (Width & Height)
- Write pattern: `_dims` MV key containing `{ width, height }` (or separate `width` and `height` fields).
- Detection: resolver requires pair candidates that differ in BOTH `width` AND `height` before creating a conflict record.
- Recording/UI: same as value/unit.

### Name & Description
- Write pattern: `_nameDesc` MV key with `{ name, description }` (or separate fields).
- Detection: conflict created only when a candidate pair differs in BOTH `name` and `description`.
- Recording/UI: identical to other semantic pairs.

### hasPart Cycles
- Detection: a dedicated resolver scans the `hasPart` graph for cycles (SCCs). If a cycle is detected it creates a conflict (e.g., kind `HasPartCycle`) with involved edge refs in `entityRefs`.
- Behavior: the resolver does NOT auto-delete edges. It marks involved edges as conflicting and adds UI highlights for all involved edges.
- Resolution: user chooses which edges to delete; deletion is an explicit CRDT write and the resolver clears the conflict once the cycle is broken.

### Feed–Medium Incompatibility
- Detection: resolver checks connections/feed types vs. medium compatibility rules.
- Recording/UI: creates a conflict (e.g., `FeedMediumIncompatible`) and highlights affected ports/connections. Resolution is manual.

---

## Notification deduplication & timeliness
- Resolver writes `graph.conflicts` and also dispatches a `ce:notification` event to ensure immediate UI feedback.
- `NotificationCenter` deduplicates toasts using a signature such as `${kind}:${sortedRefs.join(',')}:${keyHint||''}` to avoid multiple toasts for the same logical conflict.
- The dual approach (CRDT + event) ensures both immediate UX and consistent persisted state.

---

## Replication and determinism
- All persistent conflict state lives in CRDTs, so any client that receives the same CRDT state will observe the same conflict records and resolution results.
- Resolvers include an "already present" check before creating a new conflict record to minimize duplicate records; since `graph.conflicts` is a CRDT, independent creation attempts converge.

---

## Developer notes & where to inspect
- Resolver code: `src/collabs/semantics/resolveValueUnitConflicts.ts` and other files under `src/collabs/semantics/`.
- Conflict storage: `graph.conflicts` (CRDT map).
- Notification UI: `src/ui/notifications/NotificationCenter.tsx` (listens for `ce:notification`).
- Resolution helpers: `src/collabs/semantics/resolveMVRegisterConflicts.ts` / `applyMVRegisterResolution`.

---

## QA / Testing checklist
- Reproduce semantic conflict (value/unit) with two tabs:
  1. Tab A sets `Width` value.
  2. Tab B concurrently sets `WidthUnit`.
  3. Wait for resolver: verify `graph.conflicts` entry is created, `NotificationCenter` shows a toast, attribute row highlighted in both tabs.
- Reproduce dims conflict by concurrently changing `width` in one tab and `height` in another; resolver should flag only if both differ concurrently.
- Reproduce `hasPart` cycle by creating reciprocal `hasPart` edges across two nodes; ensure cycle conflict is recorded and edges highlighted; resolution by deleting one edge clears the conflict.

---

If you want a sequence diagram or a runnable reproduction script (two-headless browser tabs or an automated test) I can add that next and run a live test against the dev server.
