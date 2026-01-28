import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../collabs/model/CEngineeringGraph";
import { PhysicalKind } from "../models/relationships/enums/RelationshipTypes";
import resolveFeedMediumConflicts from "../collabs/semantics/resolveFeedMediumConflicts";
import { ConflictKind } from "../collabs/model/enums/ConflictEnum";

test("Invariant #8: Feed medium mismatch is flagged as conflict (headless)", async () => {
  // Create a headless in-process collab runtime + graph (no Electron, no network)
  const doc = new CRuntime();
  const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

  // Create components and a feeds relationship with mismatched media
  const aId = `A-${Date.now()}`;
  const bId = `B-${Date.now()}`;
  const relId = `R-${Date.now()}`;

  graph.components.set(aId, "equipment", `EqA-${aId.slice(-4)}`);
  graph.components.set(bId, "equipment", `EqB-${bId.slice(-4)}`);

  const A: any = graph.components.get(aId);
  const B: any = graph.components.get(bId);
  if (A?.outputMedium) A.outputMedium.value = "Water";
  if (B?.inputMedium) B.inputMedium.value = "Steam";

  graph.relationships.set(relId, "physical", PhysicalKind.Feeds, aId, bId, null, null, null);

  // Run the resolver synchronously (no need to wait for a background service)
  resolveFeedMediumConflicts(graph as any, "test-user");

  // Inspect conflicts
  const conflicts: any[] = [];
  try {
    if (graph.conflicts?.entries) {
      for (const [id, c] of graph.conflicts.entries()) {
        if (c.kind?.value === ConflictKind.FeedMediumMismatch && (c.status?.value ?? "open") === "open") {
          conflicts.push({ id: String(id), refs: Array.from(c.entityRefs?.values ? c.entityRefs.values() : []).map(String) });
        }
      }
    }
  } catch (e) {}

  expect(conflicts.length).toBeGreaterThan(0);

  const snap = { comps: [], rels: [] as string[] } as any;
  try {
    for (const c of graph.components.values()) snap.comps.push(String(c.id?.value ?? c.id));
    for (const r of graph.relationships.values()) snap.rels.push(String(r.id?.value ?? r.id));
  } catch (e) {}

  expect(snap.comps).toContain(aId);
  expect(snap.comps).toContain(bId);
  expect(snap.rels).toContain(relId);
});
