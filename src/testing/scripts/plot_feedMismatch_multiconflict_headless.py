# src/testing/scripts/plot_feedMismatch_multiconflict_headless_detect_avg.py
import json
import sys
import matplotlib.pyplot as plt

if len(sys.argv) < 2:
    print("Usage: python3 src/testing/scripts/plot_feedMismatch_multiconflict_headless_detect_avg.py <json_file>")
    sys.exit(1)

with open(sys.argv[1], "r") as f:
    data = json.load(f)

series = data["series"]

C = [row["conflicts"] for row in series]

detect_avg = [row["detect"]["avgMs"] for row in series]
detect_p50 = [row["detect"]["p50Ms"] for row in series]

plt.figure(figsize=(9, 5))
plt.plot(C, detect_avg, marker="o", label="detect avg (ms)")
plt.plot(C, detect_p50, marker="o", label="detect p50/median (ms)")

plt.title("FeedMediumMismatch (headless multiconflict): Detect latency vs #mismatches")
plt.xlabel("Injected mismatches C (≈ number of open FeedMediumMismatch conflicts)")
plt.ylabel("Resolver time per run (ms)")
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.show()
