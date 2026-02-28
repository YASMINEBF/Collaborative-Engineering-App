import * as collabs from "@collabs/collabs";
import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import { Medium } from "../../models/attributes/enums/Medium";

export type RelId = string;

export class CRelationship extends collabs.CObject {
  readonly id: collabs.CVar<string>;
  readonly type: collabs.CVar<string>;
  readonly kind: collabs.CVar<RelationshipKind>;
  readonly sourceId: collabs.CVar<string>;
  readonly targetId: collabs.CVar<string>;
  readonly sourceHandle: collabs.CVar<string | null>;
  readonly targetHandle: collabs.CVar<string | null>;
  readonly medium: collabs.CVar<Medium | null>;

  // useful for concurrency checks (delete vs create)
  readonly createdAt: collabs.CVar<number>;
  readonly createdBy: collabs.CVar<string>;

  constructor(
    init: collabs.InitToken,
    id: string,
    type: string,
    kind: RelationshipKind,
    sourceId: string,
    targetId: string,
    medium: Medium | null = null,
    sourceHandle: string | null = null,
    targetHandle: string | null = null,
    // optional args so older callers still compile
    createdAt: number = 0,
    createdBy: string = ""
  ) {
    super(init);

    this.id = this.registerCollab("id", (i) => new collabs.CVar(i, id));
    this.type = this.registerCollab("type", (i) => new collabs.CVar(i, type));
    this.kind = this.registerCollab("kind", (i) => new collabs.CVar(i, kind));
    this.sourceId = this.registerCollab("sourceId", (i) => new collabs.CVar(i, sourceId));
    this.targetId = this.registerCollab("targetId", (i) => new collabs.CVar(i, targetId));
    this.sourceHandle = this.registerCollab(
      "sourceHandle",
      (i) => new collabs.CVar<string | null>(i, sourceHandle)
    );
    this.targetHandle = this.registerCollab(
      "targetHandle",
      (i) => new collabs.CVar<string | null>(i, targetHandle)
    );

    // safe during load/receive
    this.medium = this.registerCollab("medium", (i) => new collabs.CVar<Medium | null>(i, medium));

    // safe during load/receive
    this.createdAt = this.registerCollab("createdAt", (i) => new collabs.CVar<number>(i, createdAt));
    this.createdBy = this.registerCollab("createdBy", (i) => new collabs.CVar<string>(i, createdBy));
  }
}

export default CRelationship;
