import { Attribute } from "./";
import { Color } from "./enums/Color";
import { Medium } from "./enums/Medium";
import { PortType } from "./enums/PortType";

type AllowedEnums = typeof Color | typeof Medium | typeof PortType;

export class EnumAttribute<T> extends Attribute<T> {
  constructor(name: string, value: T, private enumType: AllowedEnums) {
    super(name, value);
  }
  
  getEnumValues(): T[] {
    return Object.values(this.enumType) as T[];
  }
}