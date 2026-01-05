
export type StructuralKind = 'hasPart';

export type LogicalKind = 'controls';

export type PhysicalKind = 'connects'| 'feeds';

export type RelationshipKind = StructuralKind | LogicalKind | PhysicalKind;
