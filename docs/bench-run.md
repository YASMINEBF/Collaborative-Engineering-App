# Bench Run — `npm run bench`

This document explains what happens when you run `npm run bench` in this repository, what it measures, what files are involved, where results are written, and recommended next steps.

## Command executed

- `npm run bench`
  - Expands to: `VITE_E2E=1 npx playwright test src/testing --workers=1` (see `package.json`).

## What the runner does

- Launches Playwright to run the tests under `src/testing/` headlessly using a single worker.
- Runs benchmark and correctness/unit tests that exercise the project's CRDT-based resolver logic.
- Tests instantiate a `CRuntime` + `CEngineeringGraph`, mutate CVars and relationships, invoke resolver functions (e.g. `resolveFeedMediumConflicts`), and assert expected conflicts/invariants.

## Key files

- `src/testing/feedMediumMismatch.bench.spec.ts` — benchmark measuring two phases:
  - detect: time to detect a FeedMediumMismatch after creating a mismatched `A.outputMedium` / `B.inputMedium` pair.
  - detect-after-fix: time to confirm the conflict is gone after simulating a fix.
- `src/testing/feedMediumMismatch.spec.ts` — e2e-style test that uses the UI test API (`__CE_TEST_API__`) for integration checks.
- `src/testing/feedMediumMismatch.unit.spec.ts` — unit-level correctness test that runs in-process.
- `src/testing/helpers/invariants.ts` — small invariant checker helpers (`findFeedMediumMismatches`, `getOpenConflictsByKind`).
- `src/testing/exposeTestApi.ts` — exposes `window.__CE_TEST_API__` for browser/e2e tests.
- `src/collabs/semantics/resolveFeedMediumConflicts.ts` — resolver under test.

## What each bench run does (detailed)

1. For N runs (configurable in the bench file):
   - Create a fresh `CRuntime` and `CEngineeringGraph`.
   - Create components A and B and a feeds relationship A → B where `A.outputMedium !== B.inputMedium`.
   - Call `resolveFeedMediumConflicts(graph, "bench")` and record detection latency (T_detect).
   - Assert a `FeedMediumMismatch` conflict exists and references the relationship.
   - Simulate a fix (e.g., set `B.inputMedium = A.outputMedium`).
   - Call the resolver again and record the post-fix check latency (T_afterFix).
   - Assert no open `FeedMediumMismatch` conflicts remain.
2. Aggregate latencies across runs and compute statistics (avg, min, max, p50, p95).
3. Print stats to console and write JSON artifact to `benchmark-results/feedMediumMismatch.json`.

## What the results mean (example interpretation)

- `detect` stats tell you how long the resolver takes to find the invariant violation.
- `after-fix` stats tell you how long it takes to confirm the invariant is satisfied after a simulated correction.
- Low averages indicate the resolver runs quickly; p95/max show outliers (GC/JIT noise).
- Tests also verify correctness: conflict created, references expected entities, cleared after fix.

## Outputs

- Console logs (Playwright output) include pass/fail and printed stats.
- JSON artifact: `benchmark-results/feedMediumMismatch.json` (contains stats and timestamp).

## Purpose

- Verify correctness: ensure the resolver detects the right conflicts and the conflict references the correct entities.
- Validate fix behavior: ensure applying a resolution clears the conflict and restores the invariant.
- Measure performance: benchmark resolver latency for detection and after-fix verification under a repeatable workload.

## Recommendations / next steps

- Increase `RUNS` and `WARMUP` for more stable measurements.
- Persist `benchmark-results/*.json` in CI to detect regressions.
- Add replica-convergence tests (two `CRuntime` instances exchanging updates) to prove distributed convergence.
- Add p99 reporting and histograms for richer analysis.

---

If you want this committed as a different filename or added to CI to publish artifacts, tell me where to place it and I will patch the repo accordingly.