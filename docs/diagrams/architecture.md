# Architecture Diagrams

## Static Architecture (components)

```mermaid
graph TD
  subgraph App[Desktop App]
    Renderer[Electron Renderer (React + React Flow)]
    Main[Electron Main]
  end

  subgraph Frontend
    Renderer --> CollabProvider[CollabProvider]
    CollabProvider --> CRuntime[CRuntime (@collabs)]
    Renderer --> UI[GraphCanvas / AttributesSidebar / NotificationCenter]
  end

  subgraph Network
    CRuntime --> WSClient[@collabs/ws-client]
    WSClient --> WSServer[@collabs/ws-server]
    WSServer --> OtherClients[(Other Clients)]
  end

  subgraph Model
    CEngineeringGraph[CEngineeringGraph]
    CComponent[CComponent / CEquipment / CPort]
    CRelationship[CRelationship]
    CConflict[CConflict]
  end

  CollabProvider --> CEngineeringGraph
  CEngineeringGraph --> CComponent
  CEngineeringGraph --> CRelationship
  CEngineeringGraph --> CConflict
```

## Dynamic Architecture (sequence: create component → connect → conflict)

```mermaid
sequenceDiagram
  participant User
  participant UI as Renderer/UI
  participant CP as CollabProvider
  participant CR as CRuntime
  participant WS as WS Server
  participant Other as Other Client
  participant Resolver as ConflictResolver
  participant NC as NotificationCenter

  User->>UI: click create component
  UI->>CP: createComponent(command)
  CP->>CR: apply CRDT ops (CComponent added)
  CR->>WS: send ops
  WS->>Other: broadcast ops
  Other->>CR: apply ops
  CR-->>CP: update (component exists)

  User->>UI: connect A -> B (create feeds)
  UI->>CP: createRelationship(kind=Feeds, source, target)
  CP->>CR: apply CRDT ops (relationship)
  CR->>Resolver: schedule resolve
  Resolver->>CR: detect FeedMediumMismatch
  Resolver->>CR: create CConflict
  CR-->>NC: CConflict present
  NC->>UI: show persistent notification
```

Notes:
- Sequence shows the optimistic CRDT write model (writes applied locally and replicated), and a later semantics pass (resolver) that may create authoritative conflict records which drive UI notifications.

```
