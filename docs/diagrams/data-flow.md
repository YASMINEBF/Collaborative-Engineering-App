# Data Flow Diagram

```mermaid
flowchart LR
  subgraph UserEnv[User Environment]
    U[User] -->|interacts| UI[Electron Renderer / React UI]
  end

  UI -->|dispatches commands| CollabUI[CollabProvider / Commands]
  CollabUI -->|writes CRDT ops| CRuntime[CRuntime (@collabs)]
  CRuntime -->|sends ops over WS| WSClient[@collabs/ws-client]
  WSClient -->|connects| WSServer[@collabs/ws-server]
  WSServer -->|broadcasts ops| OtherReplicas[Other Clients]
  OtherReplicas -->|receive ops| CRuntimeOther[CRuntime]
  CRuntimeOther -->|update| UIOther[React UI]

  %% Side concerns
  CollabUI -->|persists local userId| LocalStorage[(LocalStorage)]
  CRuntime -->|triggers| Resolver[Conflict Resolver]
  Resolver -->|creates| Conflicts[CConflict entries]
  Conflicts -->|display| NotificationCenter[NotificationCenter]

  style CRuntime fill:#f9f,stroke:#333,stroke-width:1px
  style WSServer fill:#ffd,stroke:#333
  style Resolver fill:#efe,stroke:#333
```

Notes:
- This shows the runtime path for user actions → CRDT operations → network → other replicas.
- Conflict resolver and notification center are authoritative readers of CRDT state (CConflict objects).
```
