# CEngineeringGraph — One-page Summary

**What**: Collaborative engineering graph using Collabs CRDTs + React/React Flow in Electron

**Key Concepts**
- **Model**: components (equipment), relationships (feeds), and `CConflict` entries (authoritative conflict records).
- **Replication**: Collabs runtime (CObject, CMap, CVar, CValueMap/Set) replicated via provider.
- **UI**: Adapter maps collab objects → React Flow nodes/edges; `NotificationCenter` surfaces `CConflict` events.

**Collabs Types (examples)**
- Components: `CMap<componentId, CObject>` with `CVar` fields like `name`, `inputMedium`, `outputMedium`.
- Relationships: `CMap<relId, CObject>` with `source`, `target`, `medium` (nullable).
- Conflicts: `CMap<conflictId, CObject>` of kind `FeedMediumMismatch` with `entityRefs`, `createdBy`, `status`.

Example (pseudo):

- Component fields:
  - `component.name` : `CVar<string>`
  - `component.inputMedium` : `CVar<Medium | null>`
  - `component.outputMedium` : `CVar<Medium | null>`

**Conflict policy**
- Concurrent mismatch between a relationship medium and an equipment medium creates a `FeedMediumMismatch` `CConflict` (keeps both values).
- UI highlights nodes/edges for open conflicts; `NotificationCenter` shows a single notification per conflict.
- Resolver scans and deduplicates conflicts; deletes/resolves them when compatibility is restored.

**Flow (user action → system)**
1. User edits `outputMedium` in Attributes Sidebar.
2. Local writer applies change; resolver checks relationships for mismatches.
3. If mismatch found, create `CConflict`; adapter marks node/edge; NotificationCenter notifies once.
4. When user fixes medium, resolver deletes `CConflict`; adapter removes highlight; notification cleared.

**Why this design**
- Keeps concurrent edits visible (no silent deletion).
- `CConflict` is authoritative: easy to surface, audit, and reason about across replicas.
- Simple deterministic resolver + dedupe prevents notification spam and ensures consistent UI.

**Next steps / UX ideas**
- Add a "Conflict Inspector" panel listing open `CConflict` entries (jump-to, resolve actions).
- Show conflict IDs or related entity links in notifications.
- Export slide as PNG/PDF for presentations.

---
Created for the Collaborative Engineering App — ask if you'd like a PDF, slide deck format, or a shorter executive summary.