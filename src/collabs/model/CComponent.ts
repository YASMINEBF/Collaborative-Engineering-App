import * as collabs from "@collabs/collabs";

export abstract class CComponent extends collabs.CObject {
  readonly id: collabs.CVar<string>;
  readonly type: collabs.CVar<string>;

  // Domain-level name (NOT Collabs internal name)
  readonly uniqueName: collabs.CVar<string>;

  readonly description: collabs.CVar<string>;
  readonly attrs: collabs.CValueMap<string, any>;

  readonly parentId: collabs.CVar<string | null>;
  readonly position: collabs.CVar<{ x: number; y: number }>;

  constructor(
    init: collabs.InitToken,
    id: string,
    type: string,
    uniqueName = ""
  ) {
    super(init);

    this.id = this.registerCollab("id", i => new collabs.CVar(i, id));
    this.type = this.registerCollab("type", i => new collabs.CVar(i, type));
    this.uniqueName = this.registerCollab(
      "uniqueName",
      i => new collabs.CVar(i, uniqueName)
    );
    this.description = this.registerCollab(
      "description",
      i => new collabs.CVar(i, "")
    );

    this.attrs = this.registerCollab("attrs", i => new collabs.CValueMap(i));
    this.parentId = this.registerCollab(
      "parentId",
      i => new collabs.CVar<string | null>(i, null)
    );
    this.position = this.registerCollab(
      "position",
      i => new collabs.CVar(i, { x: 0, y: 0 })
    );
  }
}

export default CComponent;
