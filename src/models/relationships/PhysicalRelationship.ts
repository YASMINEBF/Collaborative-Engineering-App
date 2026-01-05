import { Component } from "../components";
import { Relationship } from "./Relationship";
import { PhysicalKind } from "./enums/RelationshipTypes";

export class PhysicalRelationship extends Relationship {
  constructor(
    id: string,
    source: Component,
    target: Component,
    kind: PhysicalKind
  ) {
    super(id, source, target, 'physical', kind);
  }
}