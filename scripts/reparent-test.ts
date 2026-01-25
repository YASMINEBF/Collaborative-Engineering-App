import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../src/collabs/model/CEngineeringGraph.ts";
import { createComponent, deleteComponent } from "../src/collabs/commands/components.ts";
import { createRelationship } from "../src/collabs/commands/relationships.ts";
import { StructuralKind } from "../src/models/relationships/enums/RelationshipTypes.ts";

async function run() {
  const doc = new CRuntime();
  const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

  // Create components a, b, c
  createComponent(graph as any, "a", "equipment", "A", "tester");
  createComponent(graph as any, "b", "equipment", "B", "tester");
  createComponent(graph as any, "c", "equipment", "C", "tester");

  // Create a -> b, b -> c as hasPart
  createRelationship(graph as any, "rel-ab", StructuralKind.HasPart as any, "a", "b", null, null, null, "tester");
  createRelationship(graph as any, "rel-bc", StructuralKind.HasPart as any, "b", "c", null, null, null, "tester");

  console.log("Before delete: relationships:");
  for (const r of graph.relationships.values()) {
    try {
      console.log(r.id?.value ?? r.id, r.kind?.value, r.sourceId?.value, r.targetId?.value);
    } catch (e) {}
  }

  // Delete b
  deleteComponent(graph as any, "b", "tester");

  console.log("After delete: relationships:");
  for (const r of graph.relationships.values()) {
    try {
      console.log(r.id?.value ?? r.id, r.kind?.value, r.sourceId?.value, r.targetId?.value);
    } catch (e) {}
  }

  // Check for a -> c exists
  let found = false;
  for (const r of graph.relationships.values()) {
    try {
      if (r.kind?.value === StructuralKind.HasPart && r.sourceId?.value === "a" && r.targetId?.value === "c") {
        found = true;
        break;
      }
    } catch (e) {}
  }

  if (found) {
    console.log("TEST PASS: found a->c hasPart relationship after deleting b");
    process.exit(0);
  } else {
    console.error("TEST FAIL: a->c hasPart relationship not found after deleting b");
    process.exit(2);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
