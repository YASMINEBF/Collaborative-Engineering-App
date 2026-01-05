import { Attribute } from "./Attribute";
import { Unit } from "./enums/Unit";
//value should be a number
export class UnitAttribute extends Attribute<number> {
  constructor(name: string, value: number, public unit: Unit) {
    super(name, value);
  }
}