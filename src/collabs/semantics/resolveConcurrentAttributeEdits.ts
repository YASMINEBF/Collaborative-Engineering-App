import type CEngineeringGraph from "../model/CEngineeringGraph";
import { ConflictKind } from "../model/enums/ConflictEnum";

/**
 * Detects concurrent edits to the same attribute by different users.
 * 
 * Since Collabs uses last-writer-wins (LWW) for CVar/CValueMap, by the time
 * we see a synced value, the "losing" value is gone. To detect concurrent edits:
 * 
 * 1. We track local edits (value, userId, timestamp) in a pending edits map
 * 2. When a sync brings in a different value from a different user within
 *    the concurrency window, we have a conflict
 * 3. We create a conflict with both values so the user can choose
 * 
 * Note: TextCRDT (description) handles merging automatically, so we skip it.
 * Value and unit are treated separately (not as pairs) since that's covered
 * by resolveValueUnitConflicts.
 */

// Window for considering edits as "concurrent" (ms)
const CONCURRENCY_WINDOW_MS = 8000;

// Attributes to check for concurrent edits (skip TextCRDT attributes)
const CHECKABLE_ATTRIBUTES = [
  "uniqueName",
  "color",
  "medium",
  "inputMedium",
  "outputMedium",
  "state",
  "signalType",
  "direction",
  "width",
  "widthUnit",
  "height",
  "heightUnit",
  "capacity",
  "capacityUnit",
  "flowRate",
  "flowRateUnit",
  "pressure",
  "pressureUnit",
  "temperature",
  "temperatureUnit",
];

// In-memory tracking of local pending edits
// Key: `${componentId}::${attributeName}` → { value, userId, timestamp, lastKnownBeforeEdit }
const pendingLocalEdits = new Map<string, {
  value: any;
  userId: string;
  timestamp: number;
  lastKnownBeforeEdit: any; // The value BEFORE the user made their edit
}>();

// Track last known synced values (updated continuously as syncs arrive)
// Key: `${componentId}::${attributeName}` → value
const lastKnownValues = new Map<string, any>();

/**
 * Record a local edit to an attribute.
 * Call this when the local user changes an attribute value.
 * 
 * @param lastKnownBeforeEdit - The value that was in the field BEFORE the user started editing.
 *                              This is critical for detecting true concurrency!
 */
export function recordLocalAttributeEdit(
  componentId: string,
  attributeName: string,
  value: any,
  userId: string,
  lastKnownBeforeEdit?: any
) {
  const key = `${componentId}::${attributeName}`;
  
  // Use provided lastKnown, or fall back to what we have tracked
  const beforeValue = lastKnownBeforeEdit !== undefined 
    ? lastKnownBeforeEdit 
    : lastKnownValues.get(key);
  
  pendingLocalEdits.set(key, {
    value,
    userId,
    timestamp: Date.now(),
    lastKnownBeforeEdit: beforeValue,
  });
  
  // eslint-disable-next-line no-console
  console.debug(`[ConcurrentAttrEdit] Recorded local edit: ${key} = ${JSON.stringify(value)} by ${userId}, before was: ${JSON.stringify(beforeValue)}`);
}

/**
 * Get the primitive value from a CRDT wrapper.
 */
function getValue(attr: any): any {
  if (attr === null || attr === undefined) return undefined;
  if (typeof attr === "object" && "value" in attr) {
    return attr.value;
  }
  return attr;
}

/**
 * Main resolver: detects concurrent attribute edits by comparing
 * current synced values against pending local edits.
 */
export default function resolveConcurrentAttributeEdits(
  graph: CEngineeringGraph,
  currentUserId = "system"
) {
  const now = Date.now();
  
  // Clean up old pending edits (outside concurrency window)
  for (const [key, edit] of pendingLocalEdits.entries()) {
    if (now - edit.timestamp > CONCURRENCY_WINDOW_MS * 2) {
      pendingLocalEdits.delete(key);
    }
  }

  // Scan all components for concurrent edits
  try {
    for (const comp of graph.components.values()) {
      try {
        const compId = String(comp.id?.value ?? comp.id ?? "");
        const compName = String(comp.uniqueName?.value ?? comp.uniqueName ?? compId);

        // Check direct attributes on the component
        for (const attrName of CHECKABLE_ATTRIBUTES) {
          try {
            const attr = (comp as any)[attrName];
            if (!attr) continue;

            const currentValue = getValue(attr);
            if (currentValue === undefined) continue;

            const key = `${compId}::${attrName}`;
            const pendingEdit = pendingLocalEdits.get(key);

            // TRUE CONCURRENT CONFLICT DETECTION:
            // A conflict only occurs when:
            // 1. We have a pending local edit (user made a change)
            // 2. The synced value is DIFFERENT from our local edit (our edit "lost" or hasn't synced yet)
            // 3. The synced value is ALSO different from what was there BEFORE our edit
            //    (meaning someone ELSE also changed it concurrently!)
            // 4. Within the concurrency time window
            //
            // If synced == lastKnownBeforeEdit, that means NO remote change happened,
            // so no concurrent conflict (just our local edit waiting to sync or winning)
            //
            // If synced == pendingEdit.value, our edit won, no conflict
            //
            // If synced != pendingEdit.value AND synced != lastKnownBeforeEdit → TRUE CONCURRENCY!
            
            if (pendingEdit && 
                now - pendingEdit.timestamp < CONCURRENCY_WINDOW_MS) {
              
              const syncedStr = JSON.stringify(currentValue);
              const localStr = JSON.stringify(pendingEdit.value);
              const beforeStr = JSON.stringify(pendingEdit.lastKnownBeforeEdit);
              
              // Check for true concurrency
              if (syncedStr !== localStr && syncedStr !== beforeStr) {
                // Current synced value differs from BOTH our edit AND what was there before
                // → Someone else made a different concurrent edit!
                // eslint-disable-next-line no-console
                console.log(`%c[ConcurrentAttrEdit] CONFLICT DETECTED: ${compName}.${attrName}`, 
                  "color: red; font-weight: bold", {
                    beforeEdit: pendingEdit.lastKnownBeforeEdit,
                    localValue: pendingEdit.value,
                    localUser: pendingEdit.userId,
                    syncedValue: currentValue,
                  });

                // Check if conflict already exists
                let alreadyExists = false;
                for (const existing of graph.conflicts.values()) {
                  try {
                    if (existing.kind?.value !== ConflictKind.ConcurrentAttributeEdit) continue;
                    if (existing.status?.value !== "open") continue;
                    const w = existing.winningValue?.value as any;
                    if (w?.componentId === compId && w?.attributeName === attrName) {
                      alreadyExists = true;
                      break;
                    }
                  } catch {}
                }

                if (!alreadyExists) {
                  // Create conflict with both values
                  const conflictId = `conf-attr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                  graph.conflicts.set(conflictId, ConflictKind.ConcurrentAttributeEdit);
                  const conflict = graph.conflicts.get(conflictId);
                  if (conflict) {
                    conflict.entityRefs.add(compId);

                    // The synced (remote) value is "winning" (it's what's currently stored)
                    conflict.winningValue.value = {
                      componentId: compId,
                      componentName: compName,
                      attributeName: attrName,
                      value: currentValue,
                      editedBy: "remote user",
                    };

                    // The local value we had is "losing"
                    conflict.losingValues.value = [{
                      componentId: compId,
                      componentName: compName,
                      attributeName: attrName,
                      value: pendingEdit.value,
                      editedBy: pendingEdit.userId,
                    }];

                    conflict.createdBy.value = currentUserId;
                    conflict.createdAt.value = now;
                    conflict.status.value = "open";

                    // eslint-disable-next-line no-console
                    console.log(`%c[ConcurrentAttrEdit] Created conflict ${conflictId}`, 
                      "color: orange; font-weight: bold", {
                        compName,
                        attrName,
                        options: [currentValue, pendingEdit.value],
                      });
                  }
                }

                // Clear the pending edit since we've processed it
                pendingLocalEdits.delete(key);
              } else if (syncedStr === localStr) {
                // Our edit won or synced successfully - clear pending
                pendingLocalEdits.delete(key);
              }
              // If syncedStr === beforeStr, no change yet - keep pending edit
            }

            // Update last known value for next check
            lastKnownValues.set(key, currentValue);
          } catch {}
        }

        // Also check attributes in the attrs map
        try {
          const attrs = (comp as any).attrs;
          if (attrs && typeof attrs.entries === "function") {
            for (const [attrName, attrValue] of attrs.entries()) {
              if (!CHECKABLE_ATTRIBUTES.includes(String(attrName))) continue;

              const currentValue = getValue(attrValue);
              if (currentValue === undefined) continue;

              const key = `${compId}::${attrName}`;
              const pendingEdit = pendingLocalEdits.get(key);
              const lastKnown = lastKnownValues.get(key);

              if (pendingEdit && 
                  lastKnown !== undefined &&
                  JSON.stringify(currentValue) !== JSON.stringify(pendingEdit.value) &&
                  now - pendingEdit.timestamp < CONCURRENCY_WINDOW_MS) {
                
                // eslint-disable-next-line no-console
                console.log(`%c[ConcurrentAttrEdit] CONFLICT (attrs map): ${compName}.${attrName}`, 
                  "color: red; font-weight: bold");

                let alreadyExists = false;
                for (const existing of graph.conflicts.values()) {
                  try {
                    if (existing.kind?.value !== ConflictKind.ConcurrentAttributeEdit) continue;
                    if (existing.status?.value !== "open") continue;
                    const w = existing.winningValue?.value as any;
                    if (w?.componentId === compId && w?.attributeName === attrName) {
                      alreadyExists = true;
                      break;
                    }
                  } catch {}
                }

                if (!alreadyExists) {
                  const conflictId = `conf-attr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                  graph.conflicts.set(conflictId, ConflictKind.ConcurrentAttributeEdit);
                  const conflict = graph.conflicts.get(conflictId);
                  if (conflict) {
                    conflict.entityRefs.add(compId);
                    conflict.winningValue.value = {
                      componentId: compId,
                      componentName: compName,
                      attributeName: String(attrName),
                      value: currentValue,
                      editedBy: "remote user",
                    };
                    conflict.losingValues.value = [{
                      componentId: compId,
                      componentName: compName,
                      attributeName: String(attrName),
                      value: pendingEdit.value,
                      editedBy: pendingEdit.userId,
                    }];
                    conflict.createdBy.value = currentUserId;
                    conflict.createdAt.value = now;
                    conflict.status.value = "open";
                  }
                }

                pendingLocalEdits.delete(key);
              }

              lastKnownValues.set(key, currentValue);
            }
          }
        } catch {}
      } catch {}
    }
  } catch {}

  // Clean up resolved conflicts
  try {
    const toRemove: string[] = [];
    for (const [conflictId, conflict] of graph.conflicts.entries()) {
      try {
        if (conflict.kind?.value !== ConflictKind.ConcurrentAttributeEdit) continue;
        if (conflict.status?.value !== "open") {
          // Already resolved, can clean up
          const createdAt = conflict.createdAt?.value ?? 0;
          if (now - createdAt > 60000) { // Keep resolved for 1 minute for UI
            toRemove.push(String(conflictId));
          }
        }
      } catch {}
    }
    for (const id of toRemove) {
      try { graph.conflicts.delete(id); } catch {}
    }
  } catch {}
}

/**
 * Resolve a concurrent attribute edit conflict by choosing one value.
 */
export function resolveAttributeConflict(
  graph: CEngineeringGraph,
  conflictId: string,
  chosenValue: any
): boolean {
  try {
    const conflict = graph.conflicts.get(conflictId);
    if (!conflict) return false;
    if (conflict.kind?.value !== ConflictKind.ConcurrentAttributeEdit) return false;

    const winning = conflict.winningValue?.value as any;
    if (!winning?.componentId || !winning?.attributeName) return false;

    const comp = graph.components.get(winning.componentId);
    if (!comp) return false;

    // Set the chosen value on the component
    const attr = (comp as any)[winning.attributeName];
    if (attr && typeof attr === "object" && "value" in attr) {
      attr.value = chosenValue;
    } else {
      // Try attrs map
      try {
        const attrs = (comp as any).attrs;
        if (attrs && typeof attrs.set === "function") {
          attrs.set(winning.attributeName, chosenValue);
        }
      } catch {}
    }

    // Mark conflict as resolved
    conflict.status.value = "resolved";
    try {
      conflict.resolution.value = JSON.stringify({ chosenValue });
    } catch {}

    // Clear any pending edits for this attribute
    const key = `${winning.componentId}::${winning.attributeName}`;
    pendingLocalEdits.delete(key);
    lastKnownValues.set(key, chosenValue);

    return true;
  } catch {
    return false;
  }
}

