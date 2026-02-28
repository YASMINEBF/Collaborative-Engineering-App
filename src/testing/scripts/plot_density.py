import json
import sys
import matplotlib.pyplot as plt

if len(sys.argv) < 2:
    print("Usage: python3 plot_density.py <json_file>")
    sys.exit(1)

with open(sys.argv[1], "r") as f:
    data = json.load(f)

results = data["results"]

x = [r["mismatches"] for r in results]
y = [r["medianDetectMs"] for r in results]

plt.figure(figsize=(6,4))
plt.plot(x, y, marker="o")
plt.xlabel("Number of mismatches")
plt.ylabel("Median detect latency (ms)")
plt.title("FeedMediumMismatch — Conflict Density (N=60, ~118 edges)")
plt.tight_layout()
plt.show()
