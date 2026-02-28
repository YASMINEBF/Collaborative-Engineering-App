import json
import os
import matplotlib.pyplot as plt

# Input: the JSON produced by feedMediumMismatch.bench.spec.ts
IN_PATH = os.path.join("benchmark-results", "feedMediumMismatch.json")
OUT_PATH = os.path.join("benchmark-results", "feedMediumMismatch.bench.bar.png")

with open(IN_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

detect = data["detect"]
after = data["afterFix"]

metrics = ["avgMs", "p50Ms", "p95Ms"]
labels = ["avg", "p50", "p95"]

detect_vals = [detect[m] for m in metrics]
after_vals  = [after[m] for m in metrics]

x = list(range(len(labels)))
w = 0.35  # bar width

plt.figure(figsize=(9, 5))
plt.bar([i - w/2 for i in x], detect_vals, width=w, label="detect")
plt.bar([i + w/2 for i in x], after_vals,  width=w, label="after-fix")

plt.xticks(x, labels)
plt.ylabel("Latency (ms)")
plt.title("FeedMediumMismatch bench: summary latency (RUNS=200)")
plt.grid(True, axis="y", linestyle="--", alpha=0.4)
plt.legend()

# Annotate bars
for i, v in enumerate(detect_vals):
    plt.text(i - w/2, v, f"{v:.3f}", ha="center", va="bottom", fontsize=9)
for i, v in enumerate(after_vals):
    plt.text(i + w/2, v, f"{v:.3f}", ha="center", va="bottom", fontsize=9)

plt.tight_layout()
plt.savefig(OUT_PATH, dpi=160)
print("Wrote:", OUT_PATH)
plt.show()
