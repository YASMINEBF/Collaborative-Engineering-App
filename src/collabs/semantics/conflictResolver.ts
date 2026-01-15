import type { CRuntime } from "@collabs/collabs";
import type CEngineeringGraph from "../model/CEngineeringGraph";
import { resolveUniqueNames } from "./resolveUniqueNames";
import resolveFeedMediumConflicts from "./resolveFeedMediumConflicts";
import resolveHasPartCycles from "./resolveHasPartCycles";

type ResolverOptions = {
  debounceMs?: number;
  initialDelayMs?: number; // how long to wait before considering updates after startup
};

/**
 * Start a background conflict resolver that observes `doc` updates and runs
 * `resolveUniqueNames(graph, userId)` in a debounced, deferred way.
 * Returns a stop() function to remove listeners.
 */
export function startConflictResolver(
  doc: CRuntime,
  graph: InstanceType<typeof CEngineeringGraph>,
  currentUserId: string,
  opts?: ResolverOptions
) {
  const debounceMs = opts?.debounceMs ?? 200;
  const initialDelayMs = opts?.initialDelayMs ?? 250;

  let timer: number | null = null;
  let started = false; // set true after an initial grace period

  // After startup, run an initial grace timeout then mark started.
  const startupTimer = window.setTimeout(() => {
    started = true;
  }, initialDelayMs);

  function scheduleResolve() {
    // Only run after the startup grace window to avoid noisy work on initial load
    if (!started) return;

    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      // Defer to avoid running during receive/load handlers
      setTimeout(() => {
        try {
          resolveUniqueNames(graph, currentUserId);
          try {
            resolveFeedMediumConflicts(graph as any, currentUserId);
          } catch (e) {}
          try {
            resolveHasPartCycles(graph as any, currentUserId);
          } catch (e) {}
        } catch (e) {
          // swallow resolver errors
          console.warn("conflictResolver: resolveUniqueNames failed", e);
        }
      }, 0);
    }, debounceMs) as unknown as number;
  }

  try {
    doc.on?.("Update", scheduleResolve);
  } catch (e) {
    // If doc doesn't support eventing, we can't auto-resolve.
  }

  function stop() {
    try {
      (doc as any).off?.("Update", scheduleResolve);
    } catch {}
    if (timer != null) window.clearTimeout(timer);
    window.clearTimeout(startupTimer);
  }

  return { stop };
}

export default startConflictResolver;
