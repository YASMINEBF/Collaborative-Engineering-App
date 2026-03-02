import json
import matplotlib.pyplot as plt

INPUT_JSON = "benchmark-results/mvregister.multiconflict.headless.json"
OUTPUT_PNG = "benchmark-results/mvregister.multiconflict.headless.png"

with open(INPUT_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

series = data["series"]

C = [row["conflicts"] for row in series]
detect_avg = [row["detect"]["avgMs"] for row in series]

plt.figure(figsize=(9, 5))
plt.plot(C, detect_avg, marker="o", label="detect avg (ms)")

plt.title("MVRegister (headless multiconflict): Detect latency vs #conflicts")
plt.xlabel("Injected concurrent conflicts C (≈ number of open MVRegister conflicts)")
plt.ylabel("Resolver time per run (ms)")
plt.grid(True)
plt.legend()
plt.tight_layout()

plt.savefig(OUTPUT_PNG, dpi=150)
plt.show()

print("Saved plot to:", OUTPUT_PNG)