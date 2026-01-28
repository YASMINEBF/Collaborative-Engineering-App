import json
import matplotlib.pyplot as plt

PATH = "benchmark-results/feedMediumMismatch.scaling.N1-200.json"

with open(PATH) as f:
    data = json.load(f)

series = data["series"]

Ns = [row["N"] for row in series if row["afterFixMs"] is not None]
detect = [row["detectMs"] for row in series if row["afterFixMs"] is not None]
after = [row["afterFixMs"] for row in series if row["afterFixMs"] is not None]

plt.figure()
plt.plot(Ns, detect, marker="o", markersize=2, label="detect")
plt.plot(Ns, after, marker="o", markersize=2, label="after-fix")

plt.xlabel("Number of nodes (N)")
plt.ylabel("Resolver latency (ms)")
plt.title("FeedMediumMismatch scaling (single conflict, 1 run per N)")
plt.grid(True)
plt.legend()

plt.savefig("feedMediumMismatch_scaling.png", dpi=150)
plt.show()
