
export enum StructuralKind {
  HasPart = 'hasPart'
}

export enum LogicalKind {
  Controls = 'controls'
}

export enum PhysicalKind {
  Feeds = 'feeds'
}

export type RelationshipKind = StructuralKind | LogicalKind | PhysicalKind;
