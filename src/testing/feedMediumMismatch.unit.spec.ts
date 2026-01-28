import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../collabs/model/CEngineeringGraph";
import { PhysicalKind } from "../models/relationships/enums/RelationshipTypes";
import resolveFeedMediumConflicts from "../collabs/semantics/resolveFeedMediumConflicts";
import { ConflictKind } from "../collabs/model/enums/ConflictEnum";
import { findFeedMediumMismatches, getOpenConflictsByKind } from "./helpers/invariants";

test("Invariant #8: mismatch is flagged, then disappears after a resolution", async () => {
  const doc = new CRuntime();
  const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

  // --- Setup mismatch ---
  const aId = `A-${Date.now()}`;
  const bId = `B-${Date.now()}`;
  const relId = `R-${Date.now()}`;

  graph.components.set(aId, "equipment", `EqA-${aId.slice(-4)}`);
  graph.components.set(bId, "equipment", `EqB-${bId.slice(-4)}`);

  const A: any = graph.components.get(aId);
  const B: any = graph.components.get(bId);

  A.outputMedium.value = "Water";
  B.inputMedium.value = "Steam";

  graph.relationships.set(relId, "physical", PhysicalKind.Feeds, aId, bId, null, null, null);

  // --- Detect ---
  resolveFeedMediumConflicts(graph as any, "test-user");

  const mismatchesBefore = findFeedMediumMismatches(graph);
  expect(mismatchesBefore.length).toBe(1);
  expect(mismatchesBefore[0].relId).toBe(relId);

  const conflictsBefore = getOpenConflictsByKind(graph, ConflictKind.FeedMediumMismatch);
  expect(conflictsBefore.length).toBeGreaterThan(0);
  // Stronger correctness: conflict references the relationship id
  expect(conflictsBefore.some((c) => c.refs.includes(relId))).toBe(true);

  // --- “Manual” resolution simulation (choose ONE policy) ---
  // Policy: make B.inputMedium match A.outputMedium
  B.inputMedium.value = A.outputMedium.value;

  // Re-run resolver (or your background service would do this)
  resolveFeedMediumConflicts(graph as any, "test-user");

  // --- Assert conflict gone + invariant holds ---
  const mismatchesAfter = findFeedMediumMismatches(graph);
  expect(mismatchesAfter.length).toBe(0);

  const conflictsAfter = getOpenConflictsByKind(graph, ConflictKind.FeedMediumMismatch);
  expect(conflictsAfter.length).toBe(0);
});
