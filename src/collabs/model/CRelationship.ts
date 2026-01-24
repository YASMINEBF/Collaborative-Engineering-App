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

    constructor(
    init: collabs.InitToken,
    id: string,
    type: string,
    kind: RelationshipKind,
    sourceId: string,
    targetId: string,
    medium: Medium | null = null,
    sourceHandle: string | null = null,
    targetHandle: string | null = null
  ) {
    super(init);

    this.id = this.registerCollab("id", (i) => new collabs.CVar(i, id));
    this.type = this.registerCollab("type", (i) => new collabs.CVar(i, type));
    this.kind = this.registerCollab("kind", (i) => new collabs.CVar(i, kind));
    this.sourceId = this.registerCollab("sourceId", (i) => new collabs.CVar(i, sourceId));
    this.targetId = this.registerCollab("targetId", (i) => new collabs.CVar(i, targetId));
    this.sourceHandle = this.registerCollab("sourceHandle", (i) => new collabs.CVar<string | null>(i, sourceHandle));
    this.targetHandle = this.registerCollab("targetHandle", (i) => new collabs.CVar<string | null>(i, targetHandle));

    // initialize directly (safe during load/receive)
    this.medium = this.registerCollab("medium", (i) => new collabs.CVar<Medium | null>(i, medium));
  }
}

export default CRelationship;
