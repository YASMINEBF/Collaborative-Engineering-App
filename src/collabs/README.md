# Collabs C-Model (Engineering Graph)

This folder contains the Collabs-based CRDT model used by the Collaborative Engineering App. It documents the main collab types, storage choices, runtime constraints, and quick usage examples for the renderer and network.

## Overview

- **Root:** `CEngineeringGraph` — the single CRDT root registered on the `CRuntime`. It contains maps for `components`, `relationships`, `conflicts`, and a few indexes used by the UI and business logic.
- **Component:** `CComponent` — base collab representation for components. Typical fields: `id`, `type`, `uniqueName`, `description`, and `position` (a `CVar` holding `{ x, y }`). Attributes live in a map so they can be plain values or richer collabs.
- **Equipment:** `CEquipment` — extends `CComponent` for equipment-specific properties (presentation width/height, color, input/output medium, etc.).
- **Ports / Relationships:** `CPort`, `CRelationship` — represent connection points and links between components. Relationships are natural to render as React Flow edges.
- **Conflicts:** `CConflict` — stores conflict/merge metadata when replicas produce conflicting edits.

## Storage Choice

For the demo and to simplify dynamic creation from the UI, `components` is implemented as a `CValueMap`. That allows inserting plain JavaScript objects at runtime (e.g. when `createEquipment()` is called) without needing to register new Collabs objects dynamically.

Why this matters: Collabs requires any custom collab object types that use `doc.registerCollab(...)` to be registered before the `CRuntime` is used (before sending/receiving network messages or loading state). Registering after the runtime has been used will throw "Already used" errors. Using `CValueMap` for dynamic additions is a pragmatic workaround for demos.

## Networking

- The client uses `@collabs/ws-client` (`WebSocketNetwork`) to synchronize replicas.
- The server must implement the Collabs WS protocol. Use the official server: `@collabs/ws-server` (or a server that implements that protocol). A simple broadcast-only websocket relay is insufficient and will produce errors like `Unexpected WebSocketNetwork message type: subscribe`.

Default WS URL resolution in the app (in `createLocalDoc()`):

1. `window.COLLABS_WS_URL`
2. `import.meta.env.VITE_COLLABS_WS_URL`
3. `process.env.COLLABS_WS_URL`
4. fallback `ws://localhost:3001`

Example to run the official server on port `3001`:

```bash
# from project root
npx @collabs/ws-server --port 3001
```

Or use the npm script (if present):

```bash
npm run collabs-ws-server
```

## Usage (renderer integration)

Most consumers will call `createLocalDoc()` (implemented in `src/collabs/provider/docSetup.ts`) to create a `CRuntime`, register `CEngineeringGraph`, and attempt to connect to the WS server. The function returns the runtime, the root graph, and helper factories.

Example (pseudo-usage):

```ts
const { doc, graph, createEquipment } = createLocalDoc();

// createEquipment usually inserts a plain-value component into graph.components
createEquipment('equip-1', 'Pump A');
```

The React UI (`src/ui/Graph.tsx`) accepts both shapes:

- Collabs CObject style (e.g. component.position is a `CVar`, read via `component.position.value`).
- Plain-value style (e.g. `component.position` is `{ x, y }`).

On node drag-stop, the UI writes back to the model by either updating the `CVar` (for CObjects) or replacing the value in the `CValueMap` (for plain-values).

## Caveats & Next Steps

- If you want components to be full Collabs objects (with nested collabs inside), register their factories on the `CRuntime` before the runtime is used, e.g. during app start. That requires calling `doc.registerCollab(...)` early.
- To support two-way realtime position updates robustly, ensure `position` is a `CVar` on the component collab and update `position.value` on drag-stop.
- Edges (`CRelationship`) are not wired to React Flow in detail yet — rendering them as edges and supporting port handles is a natural next step.

## Helpful Commands

Start the Collabs WS server (port 3001):

```bash
npx @collabs/ws-server --port 3001
```

Start Vite + Electron dev (example, adapt to your `package.json`):

```bash
npm run collabs-ws-server &
npm run dev
```

Or, to run the server in a separate terminal and then the app:

```bash
# terminal 1
npx @collabs/ws-server --port 3001

# terminal 2
npm run dev
```

## Where to look

- Model root: `src/collabs/CEngineeringGraph.ts`
- Component & equipment definitions: `src/collabs/CComponent.ts`, `src/collabs/CEquipment.ts`
- Provider + doc setup: `src/collabs/provider/docSetup.ts`, `src/collabs/provider/CollabProvider.tsx`
- Network helpers: `src/collabs/network/*`
- UI adapter: `src/adapters/reactFlowAdapter.ts` and `src/adapters/hook/useGraphNodes.ts`

If you'd like, I can:

- Expand this README with diagrams and a small example app flow.
- Register factories at startup so components become first-class Collabs objects (requires code changes and ensuring registration happens before runtime use).
- Add edge rendering and port handles for React Flow.

— End
