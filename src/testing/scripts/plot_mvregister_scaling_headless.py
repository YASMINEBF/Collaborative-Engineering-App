import json
import matplotlib.pyplot as plt

INPUT_JSON = "benchmark-results/mvregister.scaling.headless.sizes.json"
OUTPUT_PNG = "benchmark-results/mvregister.scaling.headless.sizes.png"

with open(INPUT_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

series = data["series"]

N = [row["N"] for row in series]

detect_p50 = [row["detect"]["p50Ms"] for row in series]
resolution_p50 = [row["resolution"]["p50Ms"] for row in series]

plt.figure(figsize=(8, 5))

plt.plot(N, detect_p50, marker="o", label="detect (p50)")
plt.plot(N, resolution_p50, marker="o", label="after-fix (p50)")

plt.title("MVRegister scaling (headless, single concurrent conflict)")
plt.xlabel("Number of components in graph (N)")
plt.ylabel("Latency (ms)")
plt.grid(True)
plt.legend()

plt.tight_layout()
plt.savefig(OUTPUT_PNG, dpi=150)
plt.show()

print("Saved plot to:", OUTPUT_PNG)