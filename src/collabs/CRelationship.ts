import * as collabs from "@collabs/collabs";
import type { RelationshipKind } from "../models/relationships/enums/RelationshipTypes";
import { Medium } from "../models/attributes/enums/Medium";

export type RelId = string;

export class CRelationship extends collabs.CObject {
  readonly id: collabs.CVar<string>;
  readonly type: collabs.CVar<string>;               
  readonly kind: collabs.CVar<RelationshipKind>;
  readonly sourceId: collabs.CVar<string>;
  readonly targetId: collabs.CVar<string>;
  readonly medium: collabs.CVar<Medium | null>;

  constructor(
    init: collabs.InitToken,
    id: string,
    type: string,
    kind: RelationshipKind,
    sourceId: string,
    targetId: string
  ) {
    super(init);
    this.id = this.registerCollab("id", i => new collabs.CVar(i, id));
    this.type = this.registerCollab("type", i => new collabs.CVar(i, type));
    this.kind = this.registerCollab("kind", i => new collabs.CVar(i, kind));
    this.sourceId = this.registerCollab("sourceId", i => new collabs.CVar(i, sourceId));
    this.targetId = this.registerCollab("targetId", i => new collabs.CVar(i, targetId));
    this.medium = this.registerCollab("medium", i => new collabs.CVar<Medium | null>(i, null));
  }
}
export default CRelationship;