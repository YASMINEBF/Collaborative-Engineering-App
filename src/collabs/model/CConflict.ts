import * as collabs from "@collabs/collabs";
import { ConflictKind } from "./enums/ConflictEnum";

export class CConflict extends collabs.CObject {
  readonly kind: collabs.CVar<ConflictKind>;
  readonly entityRefs: collabs.CValueSet<string>;
  readonly winningValue: collabs.CVar<unknown>;
  readonly losingValues: collabs.CVar<unknown[]>;
  readonly createdBy: collabs.CVar<string>;
  readonly createdAt: collabs.CVar<number>;
  readonly status: collabs.CVar<"open" | "resolved">;
  readonly resolution: collabs.CVar<string>;
  readonly resolvedBy: collabs.CVar<string>;
  readonly resolvedAt: collabs.CVar<number>;

  constructor(init: collabs.InitToken, kind: ConflictKind) {
    super(init);
    this.kind = this.registerCollab("kind", i => new collabs.CVar(i, kind));
    this.entityRefs = this.registerCollab("entityRefs", i => new collabs.CValueSet<string>(i));
    this.winningValue = this.registerCollab("winningValue", i => new collabs.CVar<unknown>(i, null));
    this.losingValues = this.registerCollab("losingValues", i => new collabs.CVar<unknown[]>(i, []));
    this.createdBy = this.registerCollab("createdBy", i => new collabs.CVar(i, ""));
    this.createdAt = this.registerCollab("createdAt", i => new collabs.CVar(i, 0));
    this.status = this.registerCollab("status", i => new collabs.CVar<"open" | "resolved">(i, "open"));
    this.resolution = this.registerCollab("resolution", i => new collabs.CVar<string>(i, ""));
    this.resolvedBy = this.registerCollab("resolvedBy", i => new collabs.CVar<string>(i, ""));
    this.resolvedAt = this.registerCollab("resolvedAt", i => new collabs.CVar<number>(i, 0));
  }
}
export default CConflict;
