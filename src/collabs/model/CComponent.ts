import * as collabs from "@collabs/collabs";

export abstract class CComponent extends collabs.CObject {
  readonly id: collabs.CVar<string>;
  readonly type: collabs.CVar<string>;

  // Domain-level name (NOT Collabs internal name)
  readonly uniqueName: collabs.CVar<string>;

  readonly description: collabs.CText;
  readonly attrs: collabs.CValueMap<string, any>;

  readonly parentId: collabs.CVar<string | null>;
  readonly position: collabs.CVar<{ x: number; y: number }>;
  readonly createdBy: collabs.CVar<string>;

  //   tombstone fields (component still exists in CRDT but is "deleted")
  readonly isDeleted: collabs.CVar<boolean>;
  readonly deletedAt: collabs.CVar<number | null>;
  readonly deletedBy: collabs.CVar<string | null>;

  constructor(
    init: collabs.InitToken,
    id: string,
    type: string,
    uniqueName = ""
  ) {
    super(init);

    this.id = this.registerCollab("id", (i) => new collabs.CVar(i, id));
    this.type = this.registerCollab("type", (i) => new collabs.CVar(i, type));

    this.uniqueName = this.registerCollab(
      "uniqueName",
      (i) => new collabs.CVar(i, uniqueName)
    );

    this.description = this.registerCollab("description", (i) => new collabs.CText(i));

    this.attrs = this.registerCollab("attrs", (i) => new collabs.CValueMap(i));

    this.parentId = this.registerCollab(
      "parentId",
      (i) => new collabs.CVar<string | null>(i, null)
    );

    this.position = this.registerCollab(
      "position",
      (i) => new collabs.CVar(i, { x: 0, y: 0 })
    );

    this.createdBy = this.registerCollab(
      "createdBy",
      (i) => new collabs.CVar(i, "")
    );

    // tombstone vars
    this.isDeleted = this.registerCollab(
      "isDeleted",
      (i) => new collabs.CVar(i, false)
    );

    this.deletedAt = this.registerCollab(
      "deletedAt",
      (i) => new collabs.CVar<number | null>(i, null)
    );

    this.deletedBy = this.registerCollab(
      "deletedBy",
      (i) => new collabs.CVar<string | null>(i, null)
    );
  }
}

export default CComponent;
