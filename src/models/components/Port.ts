import { Component } from './';
import { UnitAttribute, TextAttribute, EnumAttribute, Medium, PortType } from '../attributes';
export class Port extends Component {
  public capacity: UnitAttribute;
  public medium: EnumAttribute<Medium>;
  public portType: EnumAttribute<PortType>;

  constructor(
    id: string,
    name: TextAttribute,
    capacity: UnitAttribute,
    medium: EnumAttribute<Medium>,
    portType: EnumAttribute<PortType>,
    description: TextAttribute
  ) {
    super(id, name, description);
    this.capacity = capacity;
    this.medium = medium;
    this.portType = portType;
    this.addAttribute(capacity);
    this.addAttribute(medium);
    this.addAttribute(portType);
  }
}