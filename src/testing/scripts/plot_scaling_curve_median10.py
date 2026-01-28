# src/testing/scripts/plot_scaling_curve_median10.py
import json
import matplotlib.pyplot as plt

PATH = "benchmark-results/feedMediumMismatch.scaling.N1-200.median10.json"

with open(PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

series = data["series"]

# N=1 has afterFixMs=None (no relationship), so filter those out for the after-fix line.
Ns_detect = [row["N"] for row in series]
detect = [row["detectMs"] for row in series]

Ns_after = [row["N"] for row in series if row.get("afterFixMs") is not None]
after = [row["afterFixMs"] for row in series if row.get("afterFixMs") is not None]

plt.figure()
plt.plot(Ns_detect, detect, marker="o", markersize=2, label="detect (median of 10)")
plt.plot(Ns_after, after, marker="o", markersize=2, label="after-fix (median of 10)")

title = "FeedMediumMismatch scaling (single conflict, median of 10 runs per N)"
plt.title(title)
plt.xlabel("Number of nodes (N)")
plt.ylabel("Resolver latency (ms)")
plt.grid(True)
plt.legend()

out_path = "benchmark-results/feedMediumMismatch.scaling.N1-200.median10.png"
plt.savefig(out_path, dpi=150)
plt.show()

print("Saved plot to:", out_path)
