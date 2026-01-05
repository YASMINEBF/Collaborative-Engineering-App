import { Component } from '../';
import { UnitAttribute, EnumAttribute, TextAttribute, Color, Medium } from '../attributes';

export class Equipment extends Component {
  public width: UnitAttribute;
  public height: UnitAttribute;
  public color: EnumAttribute<Color>;
  public inputMedium: EnumAttribute<Medium>;
  public outputMedium: EnumAttribute<Medium>;
  
  constructor(
    id: string,
    name: TextAttribute,
    width: UnitAttribute,
    height: UnitAttribute,
    color: EnumAttribute<Color>,
    inputMedium: EnumAttribute<Medium>,
    outputMedium: EnumAttribute<Medium>,
    description: TextAttribute
  ) {
    super(id, name, description);
    this.width = width;
    this.height = height;
    this.color = color;
    this.inputMedium = inputMedium;
    this.outputMedium = outputMedium;
    this.addAttribute(width);
    this.addAttribute(height);
    this.addAttribute(color);
    this.addAttribute(inputMedium);
    this.addAttribute(outputMedium);
  }
}