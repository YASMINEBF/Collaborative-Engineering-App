import { Attribute, TextAttribute } from "../attributes";
import { Relationship } from "../relationships";

export class Component {
  public attributes: Attribute<any>[] = [];
  public relationships: Relationship[] = [];

  constructor(
    public id: string,
    name: TextAttribute,             
    description: TextAttribute
  ) {
    this.attributes.push(name);
    if (description) {
      this.attributes.push(description);
    }
    }

// --- Attribute management ---

  addAttribute(attr: Attribute<any>) {
    this.attributes.push(attr);
  }

  removeAttribute(attrName: string) {
    this.attributes = this.attributes.filter(attr => attr.name !== attrName);
  }

  updateAttribute(name: string, newValue: any) {
    const attr = this.getAttribute(name);
    if (attr) {
      attr.value = newValue;
    }
  }

  getAttribute(attrName: string): Attribute<any> | undefined {
    return this.attributes.find(attr => attr.name === attrName);
  }

  hasAttribute(attrName: string): boolean {
    return this.attributes.some(attr => attr.name === attrName);
  }

  getAttributesByType(type: string): Attribute<any>[] {
    return this.attributes.filter(attr => attr.constructor.name === type);
  }

  // --- Relationship management ---

  addRelationship(rel: Relationship) {
    this.relationships.push(rel);
  }

  removeRelationship(rel: Relationship) {
    this.relationships = this.relationships.filter(r => r !== rel);
  }

  getRelationshipsByType(type: string): Relationship[] {
    return this.relationships.filter(rel => rel.type === type);
  }

  getRelationshipsByKind(kind: string): Relationship[] {
    return this.relationships.filter(rel => rel.kind === kind);
  }

  // Relationships where this component is source
  getOutgoingRelationships(): Relationship[] {
    return this.relationships.filter(rel => rel.source === this);
  }
  // Relationships where this component is target
  getIncomingRelationships(): Relationship[] {
    return this.relationships.filter(rel => rel.target === this);
  }

  // For structural relationships (hasPart)
  getChildren(): Component[] {
    return this.relationships
      .filter(rel => rel.type === 'structural' && rel.source === this && rel.kind === 'hasPart')
      .map(rel => rel.target);
  }

  getParents(): Component[] {
    return this.relationships
      .filter(rel => rel.type === 'structural' && rel.target === this && rel.kind === 'hasPart')
      .map(rel => rel.source);
  }

  //getters 
   get name(): string {
    return this.getAttribute('Name')?.value ?? '';
  }

  get description(): string {
    return this.getAttribute('Description')?.value ?? '';
  }
  get type(): string {
    return this.getAttribute('Type')?.value ?? '';
  }

}