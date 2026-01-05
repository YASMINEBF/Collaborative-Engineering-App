import { Component } from "../components";
import { Relationship } from "./Relationship";
import { LogicalKind } from "./enums/RelationshipTypes";

export class LogicalRelationship extends Relationship {
  constructor(
    id: string,
    source: Component,
    target: Component,
    kind: LogicalKind,
  ) {
    super(id, source, target, 'logical', kind);
  }
}