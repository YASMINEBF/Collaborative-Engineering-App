import json
import matplotlib.pyplot as plt

INPUT_JSON = "benchmark-results/hasPartCycles.scaling.headless.sizes.json"
OUTPUT_PNG = "benchmark-results/hasPartCycles.scaling.headless.sizes.png"

with open(INPUT_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

series = data["series"]

E = [row["edgesApprox"] for row in series]

base_p50 = [row["baseline"]["p50Ms"] for row in series]
det_p50 = [row["detect"]["p50Ms"] for row in series]
fix_p50 = [row["afterFix"]["p50Ms"] for row in series]

base_p95 = [row["baseline"]["p95Ms"] for row in series]
det_p95 = [row["detect"]["p95Ms"] for row in series]
fix_p95 = [row["afterFix"]["p95Ms"] for row in series]

plt.figure(figsize=(8, 5))

plt.plot(E, base_p50, marker="o", label="baseline p50")
plt.plot(E, det_p50, marker="o", label="detect p50")
plt.plot(E, fix_p50, marker="o", label="after-fix p50")

plt.plot(E, base_p95, linestyle="--", alpha=0.6, marker="o", label="baseline p95")
plt.plot(E, det_p95, linestyle="--", alpha=0.6, marker="o", label="detect p95")
plt.plot(E, fix_p95, linestyle="--", alpha=0.6, marker="o", label="after-fix p95")

plt.title("HasPart cycle detection scaling (headless, single cycle)")
plt.xlabel("Approx. #HasPart relationships scanned")
plt.ylabel("Resolver latency (ms)")
plt.grid(True)
plt.legend()
plt.tight_layout()

plt.savefig(OUTPUT_PNG, dpi=150)
plt.show()

print("Saved plot to:", OUTPUT_PNG)
