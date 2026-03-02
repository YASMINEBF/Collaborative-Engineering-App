import json
import matplotlib.pyplot as plt

INPUT_JSON = "benchmark-results/mvregister.2rep.density.N60.json"
OUTPUT_PNG = "benchmark-results/mvregister.2rep.density.N60.png"

with open(INPUT_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

results = data["results"]
x = [r["conflicts"] for r in results]
y = [r["medianDetectMs"] for r in results]

plt.figure(figsize=(6, 4))
plt.plot(x, y, marker="o")
plt.xlabel("Number of concurrent attribute conflicts (D)")
plt.ylabel("Median detect latency (ms)")
plt.title("MVRegister — Conflict Density (N=60, 2 replicas)")
plt.grid(True)
plt.tight_layout()
plt.savefig(OUTPUT_PNG, dpi=150)
plt.show()
print("Saved:", OUTPUT_PNG)