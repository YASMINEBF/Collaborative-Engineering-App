import * as collabs from "@collabs/collabs";

import type { ComponentType } from "./ComponentTypes";
import CEquipment from "./CEquipment";
import CPort from "./CPort";

import CRelationship from "./CRelationship";
import CConflict from "./CConflict";
import { ConflictKind } from "./enums/ConflictEnum";

import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import { Medium } from "../../models/attributes/enums/Medium";
import { PortType } from "../../models/attributes/enums/PortType";

// IDs
export type ComponentId = string;
export type RelId = string;
export type ConflictId = string;

// Union of all concrete component types stored in the map
export type AnyComponent = CEquipment | CPort;

// create entries using map.set(key, ...args)
export type ComponentSetArgs = [type: ComponentType, uniqueName: string];
export type RelationshipSetArgs = [
  type: string,
  kind: RelationshipKind,
  sourceId: string,
  targetId: string,
  medium: Medium | null,
  sourceHandle?: string | null,
  targetHandle?: string | null
];
export type ConflictSetArgs = [kind: ConflictKind];

//  Store enough data to resurrect a tombstone component later (only on concurrency)
export type DeletionRecord = {
  deletedBy: string;
  deletedAt: number;
  type: ComponentType;
  uniqueName: string;
  position: { x: number; y: number } | null;
  // Snapshot of incident relationships at time of deletion.
  // Stored as JSON string because CValueMap can't serialize nested objects.
  relationshipsJson?: string;
  // Legacy field (kept for backwards compatibility)
  relationships?: Array<{
    id: string;
    type: string;
    kind: RelationshipKind;
    sourceId: string;
    targetId: string;
    medium: Medium | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
};

export class CEngineeringGraph extends collabs.CObject {
  // Root collections
  readonly components: collabs.CMap<ComponentId, AnyComponent, ComponentSetArgs>;
  readonly relationships: collabs.CMap<RelId, CRelationship, RelationshipSetArgs>;
  readonly conflicts: collabs.CMap<ConflictId, CConflict, ConflictSetArgs>;

  // Root indices
  readonly nameIndex: collabs.CValueMap<string, ComponentId>;
  readonly feedsByPortMedium: collabs.CValueMap<string, RelId>;
  readonly parentByChild: collabs.CValueMap<ComponentId, ComponentId>;

  //  Deletion log for concurrency (delete vs edge-create):
  // if an edge arrives referencing a deleted node, we can resurrect the node as a tombstone
  readonly deletionLog: collabs.CValueMap<ComponentId, DeletionRecord>;
  // Snapshot log for deleted relationships so we can restore them during concurrent scenarios
  readonly relationshipDeletionLog: collabs.CValueMap<RelId, any>;
  
  //  Maps nodeId -> Set of relationship snapshots that were deleted when that node was deleted.
  // This is more robust than embedding in deletionLog because:
  // 1. It's a CValueSet, so concurrent adds don't conflict (set union semantics)
  // 2. We can query by nodeId directly
  // Key format: "{nodeId}::{relId}" -> relationship snapshot JSON
  readonly deletedRelationshipsByNode: collabs.CValueMap<string, string>;

  constructor(init: collabs.InitToken) {
    super(init);

    this.components = this.registerCollab("components", (i) =>
      new collabs.CMap<ComponentId, AnyComponent, ComponentSetArgs>(
        i,
        (valueInit, id, type, uniqueName) => {
          switch (type) {
            case "equipment":
              return new CEquipment(valueInit, id, uniqueName);

            case "port":
              // Provide defaults for the extra args expected by CPort.
              return new CPort(
                valueInit,
                id,
                0,
                Medium.Water,
                uniqueName,
                PortType.Input
              );

            default: {
              const _exhaustive: never = type;
              throw new Error(`Unknown component type: ${String(_exhaustive)}`);
            }
          }
        }
      )
    );

    this.relationships = this.registerCollab("relationships", (i) =>
      new collabs.CMap<RelId, CRelationship, RelationshipSetArgs>(
        i,
        (
          valueInit,
          id,
          type,
          kind,
          sourceId,
          targetId,
          medium,
          sourceHandle,
          targetHandle
        ) => {
          // IMPORTANT: do NOT do rel.medium.value = medium here
          return new CRelationship(
            valueInit,
            id,
            type,
            kind,
            sourceId,
            targetId,
            medium,
            sourceHandle ?? null,
            targetHandle ?? null
          );
        }
      )
    );

    this.conflicts = this.registerCollab("conflicts", (i) =>
      new collabs.CMap<ConflictId, CConflict, ConflictSetArgs>(
        i,
        (valueInit, _id, kind) => new CConflict(valueInit, kind)
      )
    );

    this.nameIndex = this.registerCollab(
      "nameIndex",
      (i) => new collabs.CValueMap<string, ComponentId>(i)
    );

    this.feedsByPortMedium = this.registerCollab(
      "feedsByPortMedium",
      (i) => new collabs.CValueMap<string, RelId>(i)
    );

    this.parentByChild = this.registerCollab(
      "parentByChild",
      (i) => new collabs.CValueMap<ComponentId, ComponentId>(i)
    );

    // Deletion log now stores enough metadata to re-create a tombstone node for UI
    this.deletionLog = this.registerCollab(
      "deletionLog",
      (i) => new collabs.CValueMap<ComponentId, DeletionRecord>(i)
    );

    this.relationshipDeletionLog = this.registerCollab(
      "relationshipDeletionLog",
      (i) => new collabs.CValueMap<RelId, any>(i)
    );

    //  Track relationships deleted due to node deletion
    // Key: "{nodeId}::{relId}", Value: JSON stringified relationship snapshot
    this.deletedRelationshipsByNode = this.registerCollab(
      "deletedRelationshipsByNode",
      (i) => new collabs.CValueMap<string, string>(i)
    );
  }
}

export default CEngineeringGraph;