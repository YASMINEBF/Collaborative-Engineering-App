import json
import sys
import matplotlib.pyplot as plt

if len(sys.argv) < 2:
    print("Usage: python3 plot_scaling_curve_sampled.py <json_file>")
    sys.exit(1)

path = sys.argv[1]

with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

series = data["series"]

# Extract sampled N and median values
Ns = [row["N"] for row in series]
detect = [row["detectMs"] for row in series]
after = [row["afterFixMs"] for row in series]

plt.figure(figsize=(8, 5))

plt.plot(Ns, detect, marker="o", linewidth=2, label="detect (median)")
plt.plot(Ns, after, marker="o", linewidth=2, label="after-fix (median)")

plt.title("FeedMediumMismatch Scaling (Browser, 2 Replicas)")
plt.xlabel("Number of nodes (N)")
plt.ylabel("Resolver latency (ms)")
plt.grid(True, alpha=0.3)
plt.legend()

plt.tight_layout()
plt.savefig("benchmark-results/feedMediumMismatch.scaling.sampledN.median5.png", dpi=150)
plt.show()

print("Saved plot to benchmark-results/feedMediumMismatch.scaling.sampledN.median5.png")
