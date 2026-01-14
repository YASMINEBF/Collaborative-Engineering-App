import * as collabs from "@collabs/collabs";
import CComponent from "./CComponent";
import { Color } from "../../models/attributes/enums/Color";
import { Medium } from "../../models/attributes/enums/Medium";

export class CEquipment extends CComponent {
  readonly width: collabs.CVar<number>;
  readonly height: collabs.CVar<number>;
  readonly widthUnit: collabs.CVar<string>;
  readonly heightUnit: collabs.CVar<string>;
  readonly color: collabs.CVar<Color>;
  readonly inputMedium: collabs.CVar<Medium>;
  readonly outputMedium: collabs.CVar<Medium>;


  constructor(init: collabs.InitToken, id: string, uniqueName: string) {
    super(init, id, "equipment", uniqueName);

    this.width = this.registerCollab("width", i => new collabs.CVar(i, 0));
    this.height = this.registerCollab("height", i => new collabs.CVar(i, 0));
    this.widthUnit = this.registerCollab("widthUnit", i => new collabs.CVar<string>(i, "mm"));
    this.heightUnit = this.registerCollab("heightUnit", i => new collabs.CVar<string>(i, "mm"));
    this.color = this.registerCollab(
      "color",
      i => new collabs.CVar<Color>(i, Color.Red)
    );
    this.inputMedium = this.registerCollab(
      "inputMedium",
      i => new collabs.CVar<Medium>(i, Medium.Water)
    );
    this.outputMedium = this.registerCollab(
      "outputMedium",
      i => new collabs.CVar<Medium>(i, Medium.Water)
    );
  }
}

export default CEquipment;