import json
import os
import matplotlib.pyplot as plt
import numpy as np

IN_PATH = os.path.join("benchmark-results", "mvregister.json")
OUT_PATH = os.path.join("benchmark-results", "mvregister.bench.bar.png")

with open(IN_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

detect_vals = [data["detect"]["avgMs"], data["detect"]["p50Ms"], data["detect"]["p95Ms"]]
resolve_vals = [data["resolution"]["avgMs"], data["resolution"]["p50Ms"], data["resolution"]["p95Ms"]]

labels = ["avg", "p50", "p95"]
x = np.arange(len(labels))
width = 0.35

fig, ax = plt.subplots(figsize=(7, 5))

bars1 = ax.bar(x - width / 2, detect_vals, width, label="detect", color="#4472C4")
bars2 = ax.bar(x + width / 2, resolve_vals, width, label="after-fix", color="#ED7D31")

for bar in bars1:
    h = bar.get_height()
    ax.annotate(f"{h:.3f}",
                xy=(bar.get_x() + bar.get_width() / 2, h),
                xytext=(0, 3), textcoords="offset points",
                ha="center", va="bottom", fontsize=9)

for bar in bars2:
    h = bar.get_height()
    ax.annotate(f"{h:.3f}",
                xy=(bar.get_x() + bar.get_width() / 2, h),
                xytext=(0, 3), textcoords="offset points",
                ha="center", va="bottom", fontsize=9)

ax.set_ylabel("Latency (ms)")
ax.set_title("MVRegister bench: summary latency (RUNS=200)")
ax.set_xticks(x)
ax.set_xticklabels(labels)
ax.legend()
ax.yaxis.grid(True, linestyle="--", alpha=0.7)
ax.set_axisbelow(True)

plt.tight_layout()
plt.savefig(OUT_PATH, dpi=150)
print("Saved:", OUT_PATH)