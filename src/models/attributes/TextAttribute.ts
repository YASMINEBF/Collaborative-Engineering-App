import { Attribute } from './Attribute';

export class TextAttribute extends Attribute<string> {
  constructor(
    name: string,
    value: string
  ) {
    super(name, value);
  }
}