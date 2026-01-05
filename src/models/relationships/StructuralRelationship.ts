// StructuralRelationship.ts
import { Relationship } from './';
import { Component } from "../";
import { StructuralKind } from './';
export class StructuralRelationship extends Relationship {
  

  constructor(id: string, source: Component, target: Component, kind: StructuralKind) {
    super(id, source, target, 'structural',kind);
  }
}