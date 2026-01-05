# Collabs Provider & Network

This folder contains skeleton code to get started with a Collabs-based
provider and a simple WebSocket relay for multi-window / multi-peer demos.

Files created:

- `CollabProvider.tsx` — React provider skeleton that lazy-loads `docSetup`.
- `docSetup.ts` — placeholder function `createLocalDoc()` that should create a
  `Doc` and register your `CEngineeringGraph` root collab. Replace `any` types
  once you install `@collabs/core` and your collab classes.
- `../network/wsServer.ts` — tiny WebSocket relay server that broadcasts
  messages to other connected clients. Run with Node (install `ws`).
- `../network/networkProvider.ts` — client-side WebSocket bridge. Hook its
  `onReceive` and `send` into whatever Collabs network provider API you use.

Quick start (local single-window):

1. Implement `createLocalDoc()` in `docSetup.ts` to instantiate a `Doc` and
   register your `CEngineeringGraph` root collab.
2. Wrap your app with the `CollabProvider` and use `useCollab()` to access
   `doc` and `graph` in components.

Quick start (multi-window):

1. Start the relay server:

```bash
# Install ws if needed
npm install ws
# Run the relay (transpile TS to JS if required)
node src/collabs/network/wsServer.js
```

2. In the renderer, connect to the relay and bind messages to your Collabs
   network provider.

Notes:
- The code in these files is intentionally lightweight and uses `any` to get
  a working scaffold without forcing a particular Collabs version at import
  time. Replace `any` with real Collabs types after you add the packages.
