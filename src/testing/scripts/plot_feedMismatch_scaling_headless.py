import json
import matplotlib.pyplot as plt

# Input JSON produced by the headless scaling benchmark
INPUT_JSON = "benchmark-results/feedMediumMismatch.scaling.headless.sizes.json"

# Output plot file
OUTPUT_PNG = "benchmark-results/feedMediumMismatch.scaling.headless.sizes.p50.png"

with open(INPUT_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

series = data["series"]

# X axis: approximate number of relationships scanned
edges = [row["edgesApprox"] for row in series]

# Y axis: median (p50) latencies only
detect_p50 = [row["detect"]["p50Ms"] for row in series]
after_fix_p50 = [row["afterFix"]["p50Ms"] for row in series]

plt.figure(figsize=(8, 5))

plt.plot(edges, detect_p50, marker="o", label="detect (p50)")
plt.plot(edges, after_fix_p50, marker="o", label="after-fix (p50)")

plt.title("FeedMediumMismatch scaling (headless, single mismatch)")
plt.xlabel("Approx. number of relationships scanned")
plt.ylabel("Resolver latency (ms)")
plt.grid(True)
plt.legend()

plt.tight_layout()
plt.savefig(OUTPUT_PNG, dpi=150)
plt.show()

print("Saved plot to:", OUTPUT_PNG)

