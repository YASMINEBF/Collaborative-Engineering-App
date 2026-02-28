import json
import sys
import matplotlib.pyplot as plt

if len(sys.argv) < 2:
    print("Usage: python3 src/testing/scripts/plot_feedMismatch_browser2replicas_N200_small.py <json_file>")
    sys.exit(1)

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)

detect = float(data.get("detectMs", 0))
after_fix = float(data.get("afterFixMs", 0))
N = data.get("fixed", {}).get("N", "N/A")
edges = data.get("fixed", {}).get("edgesApprox", "N/A")

plt.figure(figsize=(6,4))
plt.bar(["detect (median)", "after-fix (median)"], [detect, after_fix])
plt.title(f"FeedMediumMismatch (Browser, 2 replicas) — N={N}, edges≈{edges}")
plt.ylabel("Latency (ms)")
plt.tight_layout()
plt.show()
