"""Generate backend/test/fixtures/feature_parity.json from the Python reference implementation."""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from feature_spec import FEATURES  # noqa: E402
from features import CustomerState  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "test", "fixtures", "feature_parity.json")


def main():
    rng = random.Random(7)
    created = 1_700_000_000.0 - 200 * 86400
    state = CustomerState(account_created_ts=created)
    ts = 1_700_000_000.0
    devices = ["d1", "d2", "atk"]
    cities = ["Chennai", "Mumbai", "Delhi"]
    recips = ["acc1", "acc2", "acc3", "m:swiggy", "m:amazon", "mule9"]
    cats = ["Food & Dining", "Shopping", "Transfers", "Fuel"]
    balance = 80000.0
    steps = []
    for _ in range(400):
        ts += rng.choice([20, 45, 90, 600, 3600, 20000, 86400, 200000])
        hour = int((ts % 86400) // 3600)
        if rng.random() < 0.08:
            amount = float(rng.choice([0, 10, 500]))
            state.record_attempt(ts, amount, "F")
            steps.append({"kind": "fail", "ts": ts, "amount": amount})
            continue
        amount = float(rng.choice([150, 480.5, 1000, 1500, 2300, 7000, 25000, 60000]))
        recipient = rng.choice(recips)
        ctx = dict(ts=ts, hour=hour, amount=amount, balance=balance, device=rng.choice(devices),
                   location=rng.choice(cities), recipient=recipient, category=rng.choice(cats),
                   is_p2p=recipient.startswith("acc") or recipient.startswith("mule"), fan_in=rng.choice([0, 0, 1, 3]))
        expected = state.compute(ts, hour, amount, balance, ctx["device"], ctx["location"], recipient,
                                 ctx["category"], ctx["is_p2p"], ctx["fan_in"])
        status = rng.choices(["C", "H", "B"], [0.8, 0.1, 0.1])[0]
        state.record_attempt(ts, amount, status)
        if status == "C":
            state.record_history(hour, amount, ctx["device"], ctx["location"], recipient, ctx["category"])
            balance = max(balance - amount, 500.0)
        else:
            pass
        if rng.random() < 0.05:
            balance += 50000
        steps.append({"kind": "txn", "ctx": ctx, "status": status, "expected": expected})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump({"features": FEATURES, "account_created_ts": created, "steps": steps}, fh)
    print(f"wrote {len(steps)} steps to {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
