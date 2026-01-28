import json
import matplotlib.pyplot as plt

with open("benchmark-results/feedMediumMismatch.multirep.N200.json") as f:
    data = json.load(f)

labels = ["avg", "p50", "p95"]
detect = [
    data["detect"]["avgMs"],
    data["detect"]["p50Ms"],
    data["detect"]["p95Ms"],
]
after = [
    data["afterFix"]["avgMs"],
    data["afterFix"]["p50Ms"],
    data["afterFix"]["p95Ms"],
]

x = range(len(labels))

plt.figure()
plt.plot(x, detect, marker="o", label="detect")
plt.plot(x, after, marker="o", label="after-fix")

plt.xticks(x, labels)
plt.ylabel("Latency (ms)")
plt.xlabel("Metric")
plt.title("FeedMediumMismatch Resolver Latency (N=200)")
plt.legend()
plt.grid(True)

plt.savefig("feedMediumMismatch_latency.png", dpi=150)
plt.show()
