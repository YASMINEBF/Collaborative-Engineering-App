import { Component } from "../";
import type { RelationshipKind } from "./";

export class Relationship {
  constructor(
    public id: string,
    public source: Component,
    public target: Component,
    public type: string,
    public kind: RelationshipKind
  ) {}
}