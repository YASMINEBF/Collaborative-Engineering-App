import * as collabs from "@collabs/collabs";
import CComponent from "./CComponent";
import { Medium } from "../../models/attributes/enums/Medium";
import { PortType } from "../../models/attributes/enums/PortType";

export class CPort extends CComponent {
  readonly capacity: collabs.CVar<number>;
  readonly medium: collabs.CVar<Medium>;
  readonly portType: collabs.CVar<PortType>;

  constructor(
    init: collabs.InitToken,
    id: string,
    capacity = 0,
    medium: Medium = Medium.Water,
    uniqueName: string,
    portType: PortType = PortType.Input
  ) {
    super(init, id, "port", uniqueName);
    this.capacity = this.registerCollab("capacity", (i) => new collabs.CVar<number>(i, capacity));
    this.medium = this.registerCollab("medium", (i) => new collabs.CVar<Medium>(i, medium));
    this.portType = this.registerCollab("portType", (i) => new collabs.CVar<PortType>(i, portType));
  }
}

export default CPort;
