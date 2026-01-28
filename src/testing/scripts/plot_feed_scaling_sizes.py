import json
import matplotlib.pyplot as plt

PATH = "benchmark-results/feedMediumMismatch.scaling.sizes.json"

with open(PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

series = data["series"]

E = [row["edges"] for row in series]

base_p50 = [row["baseline"]["p50Ms"] for row in series]
base_p95 = [row["baseline"]["p95Ms"] for row in series]

det_p50 = [row["detect"]["p50Ms"] for row in series]
det_p95 = [row["detect"]["p95Ms"] for row in series]

fix_p50 = [row["afterFix"]["p50Ms"] for row in series]
fix_p95 = [row["afterFix"]["p95Ms"] for row in series]

plt.figure()

# Median lines
plt.plot(E, base_p50, marker="o", label="baseline p50 (no mismatch)")
plt.plot(E, det_p50, marker="o", label="detect p50")
plt.plot(E, fix_p50, marker="o", label="after-fix p50")

# P95 as dashed lines
plt.plot(E, base_p95, linestyle="--", marker="o", label="baseline p95")
plt.plot(E, det_p95, linestyle="--", marker="o", label="detect p95")
plt.plot(E, fix_p95, linestyle="--", marker="o", label="after-fix p95")

plt.title("FeedMediumMismatch scaling vs edges scanned (single mismatch, heavy scan)")
plt.xlabel("Number of relationships scanned (E)")
plt.ylabel("Resolver latency (ms)")
plt.grid(True)
plt.legend()

out_path = "benchmark-results/feedMediumMismatch.scaling.sizes.png"
plt.savefig(out_path, dpi=150)
plt.show()

print("Saved:", out_path)
