import json
import sys
import matplotlib.pyplot as plt
import numpy as np

if len(sys.argv) < 2:
    print("Usage: python3 plot_feedMismatch_2rep_small.py <json_file>")
    sys.exit(1)

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)

rows = data["rows"]
summary = data["summary"]

# Extract metadata
nodes = summary["graph"]["nodes"]
edges = summary["graph"]["edges"]
mismatches = summary["mismatchesPerIter"]

# Separate by phase + page
def collect(phase, page):
    return [
        r["ms"]
        for r in rows
        if r["phase"] == phase and r["page"] == page
    ]

detect_p1 = collect("detect", 1)
detect_p2 = collect("detect", 2)
after_p1 = collect("afterfix", 1)
after_p2 = collect("afterfix", 2)

# Compute medians
med_detect_p1 = np.median(detect_p1)
med_detect_p2 = np.median(detect_p2)
med_after_p1 = np.median(after_p1)
med_after_p2 = np.median(after_p2)

# ============================
# 1️⃣ Bar Plot (Clean Summary)
# ============================

plt.figure(figsize=(7,4))
labels = [
    "Detect (Replica 1)",
    "Detect (Replica 2)",
    "After-fix (Replica 1)",
    "After-fix (Replica 2)"
]
values = [
    med_detect_p1,
    med_detect_p2,
    med_after_p1,
    med_after_p2
]

plt.bar(labels, values)
plt.xticks(rotation=30, ha="right")
plt.ylabel("Median latency (ms)")
plt.title(
    f"FeedMediumMismatch — 2 Replicas\n"
    f"N={nodes}, edges≈{edges}, mismatches={mismatches}"
)
plt.tight_layout()
plt.show()

# ============================
# 2️⃣ Iteration Stability Plot
# ============================

# Plot detect times over iterations
plt.figure(figsize=(7,4))

iters = sorted(set(r["iter"] for r in rows))

detect_series_p1 = [r["ms"] for r in rows if r["phase"]=="detect" and r["page"]==1]
detect_series_p2 = [r["ms"] for r in rows if r["phase"]=="detect" and r["page"]==2]

plt.plot(iters, detect_series_p1, label="Detect Replica 1")
plt.plot(iters, detect_series_p2, label="Detect Replica 2")

plt.xlabel("Iteration")
plt.ylabel("Latency (ms)")
plt.title("Detect Phase Stability Over Iterations")
plt.legend()
plt.tight_layout()
plt.show()

# ============================
# 3️⃣ Conflict Correctness Check
# ============================

conflicts_detect = [
    r["conflicts"]
    for r in rows
    if r["phase"] == "detect"
]

conflicts_after = [
    r["conflicts"]
    for r in rows
    if r["phase"] == "afterfix"
]

print("---- Correctness Check ----")
print("Detect conflicts (unique values):", sorted(set(conflicts_detect)))
print("After-fix conflicts (unique values):", sorted(set(conflicts_after)))

print("\n---- Medians ----")
print("Detect Replica 1:", med_detect_p1, "ms")
print("Detect Replica 2:", med_detect_p2, "ms")
print("After-fix Replica 1:", med_after_p1, "ms")
print("After-fix Replica 2:", med_after_p2, "ms")
