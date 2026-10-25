"""
Synthetic but behaviourally realistic transaction data for CertiFlow.

Instead of drawing every feature independently (which produces data that no
real customer would ever generate), this script simulates individual customers
over ~75 days - each with a home city, devices, active hours, favourite
categories, regular payees and a salary-driven balance - and computes every
feature with the SAME CustomerState used to describe the serving-time
behaviour profile. That keeps train/serve skew small.

Legitimate behaviour includes hard negatives (travel, a new phone, big
purchases, festival shopping bursts, rent transfers, new payees, fat-fingered
PIN retries) so the model has to learn combinations of signals instead of
flagging any single unusual attribute.

Fraud scenarios: account takeover, card-testing velocity bursts,
authorised-push-payment scams (hardest: known device + known location),
slow drains and credential stuffing (failed attempts followed by success).
"""
import os
import sys

import numpy as np
import pandas as pd

from feature_spec import FEATURES
from features import CustomerState

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "transactions.csv")

CITIES = ["Chennai", "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Kolkata",
          "Pune", "Ahmedabad", "Kochi", "Jaipur"]
CATEGORIES = ["Food & Dining", "Groceries", "Shopping", "Bills & Utilities", "Travel",
              "Entertainment", "Health", "Fuel", "Education"]
CATEGORY_TICKET = {"Food & Dining": 0.6, "Groceries": 1.2, "Shopping": 1.6, "Bills & Utilities": 1.8,
                   "Travel": 2.6, "Entertainment": 0.7, "Health": 1.1, "Fuel": 1.3, "Education": 2.2}
TIERS = {"low": (300, 25000), "mid": (900, 60000), "high": (2400, 150000)}  # (ticket, monthly income)
DAY = 86400.0


def hour_weights(night_owl: bool):
    w = np.full(24, 0.15)
    peak = range(14, 26) if night_owl else range(8, 22)
    for h in peak:
        w[h % 24] += 1.0
    for h in (12, 13, 19, 20):
        w[h] += 0.6
    return w / w.sum()


def make_event(ts, label, scenario, amount=None, balance_frac=None, device=None, location=None,
               recipient=None, category=None, is_p2p=False, fan_in=0, kind="txn"):
    return {"ts": ts, "label": label, "scenario": scenario, "amount": amount, "balance_frac": balance_frac,
            "device": device, "location": location, "recipient": recipient, "category": category,
            "is_p2p": is_p2p, "fan_in": fan_in, "kind": kind}


def simulate_customer(cid, rng, days, rows):
    tier = rng.choice(["low", "mid", "high"], p=[0.35, 0.45, 0.20])
    ticket, income = TIERS[tier]
    ticket *= rng.uniform(0.7, 1.4)
    p2p_ticket = ticket * rng.uniform(3, 8)
    rate = rng.uniform(0.7, 2.4)
    home = str(rng.choice(CITIES))
    other_cities = [c for c in CITIES if c != home]
    devices = [f"dev-{cid}-0"] + ([f"dev-{cid}-1"] if rng.random() < 0.4 else [])
    night_owl = rng.random() < 0.10
    hw = hour_weights(night_owl)
    cat_w = rng.dirichlet(np.ones(len(CATEGORIES)) * 0.8)
    payees = [f"acc-{cid}-{i}" for i in range(int(rng.integers(3, 8)))]
    payee_w = rng.dirichlet(np.ones(len(payees)))
    p2p_prob = rng.uniform(0.12, 0.35)
    account_age_days = rng.uniform(20, 2000)
    start_ts = 0.0
    state = CustomerState(account_created_ts=start_ts - account_age_days * DAY)
    balance = income * rng.uniform(1.5, 4.0)

    def pick_hour():
        return int(rng.choice(24, p=hw))

    events = []

    # ---- legitimate context switches (hard negatives) -----------------------
    travel = None
    if rng.random() < 0.25:
        s = int(rng.integers(15, days - 10))
        travel = (s, s + int(rng.integers(3, 10)), str(rng.choice(other_cities)))
    new_phone_day = int(rng.integers(20, days - 5)) if rng.random() < 0.15 else None
    big_purchase_day = int(rng.integers(10, days)) if rng.random() < 0.30 else None
    festival_day = int(rng.integers(10, days)) if rng.random() < 0.20 else None

    def legit_context(day):
        loc, dev, scen = home, devices[0], "legit"
        if travel and travel[0] <= day <= travel[1]:
            loc, scen = travel[2], "legit_travel"
        if new_phone_day is not None and day >= new_phone_day:
            dev = f"dev-{cid}-new"
            if day == new_phone_day:
                scen = "legit_new_device"
        elif len(devices) > 1 and rng.random() < 0.25:
            dev = devices[1]
        return loc, dev, scen

    def merchant_event(ts, day, amount=None, category=None, scenario_override=None):
        loc, dev, scen = legit_context(day)
        cat = category or str(rng.choice(CATEGORIES, p=cat_w))
        amt = amount if amount is not None else float(rng.lognormal(np.log(ticket * CATEGORY_TICKET[cat]), 0.7))
        merchant = f"m:{cat}:{int(rng.integers(0, 4))}"
        return make_event(ts, 0, scenario_override or scen, amount=round(max(amt, 10.0), 2), device=dev,
                          location=loc, recipient=merchant, category=cat, is_p2p=False)

    def p2p_event(ts, day, scenario_override=None):
        loc, dev, scen = legit_context(day)
        if rng.random() < 0.06:  # brand-new legitimate payee
            recipient = f"acc-{cid}-new{int(rng.integers(0, 10**6))}"
            # most new payees get modest amounts, but some are legitimately large (deposits, tuition, purchases)
            amount = p2p_ticket * (rng.uniform(0.5, 3.0) if rng.random() < 0.85 else rng.uniform(3.0, 10.0))
            scen = "legit_new_payee" if scen == "legit" else scen
            fan_in = int(rng.poisson(0.15))
        else:
            recipient = payees[int(rng.choice(len(payees), p=payee_w))]
            amount = p2p_ticket * rng.lognormal(0, 0.4)
            fan_in = int(rng.poisson(0.08))
        if rng.random() < 0.5:
            amount = max(100.0, round(amount / 100.0) * 100.0)
        return make_event(ts, 0, scenario_override or scen, amount=round(float(amount), 2), device=dev,
                          location=loc, recipient=recipient, category="Transfers", is_p2p=True, fan_in=fan_in)

    # ---- normal timeline -------------------------------------------------------
    for day in range(days):
        n = int(rng.poisson(rate))
        for _ in range(n):
            ts = day * DAY + pick_hour() * 3600 + float(rng.uniform(0, 3599))
            ev = p2p_event(ts, day) if rng.random() < p2p_prob else merchant_event(ts, day)
            events.append(ev)
            if rng.random() < 0.012:  # fat-fingered PIN just before a legitimate payment
                events.append(make_event(ts - float(rng.uniform(20, 240)), 0, "legit_fat_finger",
                                         amount=ev["amount"], kind="fail"))
                ev["scenario"] = "legit_fat_finger" if ev["scenario"] == "legit" else ev["scenario"]
        if day % 30 == 1:
            events.append(make_event(day * DAY + 9 * 3600, 0, "salary", amount=float(income), kind="credit"))
        if day % 30 == 2 and tier != "low" and rng.random() < 0.6:
            rent = max(1000.0, round(income * 0.3 / 500.0) * 500.0)
            loc, dev, _ = legit_context(day)
            events.append(make_event(day * DAY + 10 * 3600 + float(rng.uniform(0, 3000)), 0, "legit_rent",
                                     amount=rent, device=dev, location=loc, recipient=payees[0],
                                     category="Transfers", is_p2p=True))
        if big_purchase_day == day:
            cat = str(rng.choice(["Shopping", "Travel"]))
            events.append(merchant_event(day * DAY + pick_hour() * 3600 + float(rng.uniform(0, 3500)), day,
                                         amount=ticket * rng.uniform(6, 15), category=cat,
                                         scenario_override="legit_big_purchase"))
        if festival_day == day:
            base_ts = day * DAY + int(rng.integers(11, 20)) * 3600
            for k in range(int(rng.integers(4, 9))):
                events.append(merchant_event(base_ts + k * float(rng.uniform(60, 600)), day,
                                             category="Shopping", scenario_override="legit_festival_burst"))

    # ---- fraud episodes ---------------------------------------------------------
    n_episodes = 0 if rng.random() > 0.65 else (2 if rng.random() < 0.15 else 1)
    for ep in range(n_episodes):
        day = int(rng.integers(20, days))
        scen = str(rng.choice(["ato", "velocity_burst", "app_scam", "slow_drain", "credential_stuffing"],
                              p=[0.28, 0.17, 0.25, 0.15, 0.15]))
        night = rng.random() < 0.6
        hour = int(rng.choice([0, 1, 2, 3, 4, 5, 23])) if night else int(rng.integers(6, 23))
        t0 = day * DAY + hour * 3600 + float(rng.uniform(0, 3500))
        atk_dev = f"atk-{cid}-{ep}"
        mule = f"mule-{int(rng.integers(0, 10**7))}"
        mule_fan_in = int(rng.poisson(3.0)) if rng.random() < 0.5 else 0

        if scen == "ato":
            if rng.random() < 0.10:  # session hijack / malware on the victim's own device
                atk_dev = devices[0]
            loc = str(rng.choice(other_cities)) if rng.random() < 0.85 else home
            t = t0
            for i in range(int(rng.integers(1, 5))):
                if i == 0 and rng.random() < 0.3:
                    events.append(make_event(t, 1, scen, amount=round(float(rng.uniform(100, 1500)), 2),
                                             device=atk_dev, location=loc, recipient=mule, category="Transfers",
                                             is_p2p=True, fan_in=mule_fan_in))
                else:
                    events.append(make_event(t, 1, scen, balance_frac=float(rng.uniform(0.25, 0.9)),
                                             device=atk_dev, location=loc, recipient=mule, category="Transfers",
                                             is_p2p=True, fan_in=mule_fan_in))
                t += float(rng.uniform(60, 1200))
        elif scen == "velocity_burst":
            new_dev = rng.random() < 0.7
            new_loc = rng.random() < 0.7
            t = t0
            for _ in range(int(rng.integers(5, 14))):
                if rng.random() < 0.3:
                    events.append(make_event(t - 5, 1, scen, amount=10.0, kind="fail"))
                events.append(make_event(t, 1, scen, amount=round(float(rng.uniform(1, 400)), 2),
                                         device=atk_dev if new_dev else devices[0],
                                         location=str(rng.choice(other_cities)) if new_loc else home,
                                         recipient=f"m:atk:{int(rng.integers(0, 10**6))}",
                                         category=str(rng.choice(CATEGORIES)), is_p2p=False))
                t += float(rng.uniform(5, 25))
        elif scen == "app_scam":
            t = t0
            for i in range(int(rng.integers(1, 3))):
                amount = p2p_ticket * rng.uniform(2, 12) * (1.5 if i else 1.0)
                if rng.random() < 0.5:
                    amount = round(amount / 1000.0) * 1000.0 or 1000.0
                events.append(make_event(t, 1, scen, amount=round(float(amount), 2), device=devices[0],
                                         location=home, recipient=mule if i else f"{mule}-a",
                                         category="Transfers", is_p2p=True,
                                         fan_in=mule_fan_in + (int(rng.poisson(1.5)) if rng.random() < 0.4 else 0)))
                t += float(rng.uniform(600, 3600))
        elif scen == "slow_drain":
            t = t0
            same = rng.random() < 0.7
            for i in range(int(rng.integers(3, 7))):
                events.append(make_event(t, 1, scen, amount=round(float(p2p_ticket * rng.uniform(1.5, 4)), 2),
                                         device=atk_dev if rng.random() < 0.5 else devices[0],
                                         location=home if rng.random() < 0.6 else str(rng.choice(other_cities)),
                                         recipient=mule if same else f"{mule}-{i}", category="Transfers",
                                         is_p2p=True, fan_in=mule_fan_in))
                t += float(rng.uniform(1800, 7200))
        else:  # credential_stuffing
            t = t0
            for _ in range(int(rng.integers(3, 7))):
                events.append(make_event(t, 1, scen, amount=0.0, kind="fail"))
                t += float(rng.uniform(15, 100))
            for _ in range(int(rng.integers(1, 3))):
                events.append(make_event(t, 1, scen, balance_frac=float(rng.uniform(0.3, 0.8)),
                                         device=atk_dev,
                                         location=str(rng.choice(other_cities)) if rng.random() < 0.7 else home,
                                         recipient=mule, category="Transfers", is_p2p=True, fan_in=mule_fan_in))
                t += float(rng.uniform(40, 300))

    # ---- replay in time order, maintaining balance and behavioural state ------
    events.sort(key=lambda e: e["ts"])
    for ev in events:
        ts = ev["ts"]
        hour = int((ts % DAY) // 3600)
        if ev["kind"] == "credit":
            balance += ev["amount"]
            continue
        if ev["kind"] == "fail":
            state.record_attempt(ts, ev["amount"] or 0.0, "F")
            continue

        amount = ev["amount"]
        if amount is None:
            amount = round(max(balance * ev["balance_frac"], 50.0), 2)
        if amount > balance:
            if ev["label"] == 0:
                state.record_attempt(ts, amount, "F")  # legitimate insufficient-funds attempt
                continue
            amount = round(max(balance * 0.95, 1.0), 2)
            if amount < 50:
                continue

        features = state.compute(ts, hour, amount, balance, ev["device"], ev["location"],
                                 ev["recipient"], ev["category"], ev["is_p2p"], ev["fan_in"])
        rows.append({**features, "is_fraud": ev["label"], "customer_id": cid, "ts": ts, "scenario": ev["scenario"]})

        if ev["label"] == 0:
            status = "C"
        else:
            status = "C" if rng.random() < 0.15 else str(rng.choice(["B", "H"]))  # some fraud slips through
        state.record_attempt(ts, amount, status)
        if status == "C":
            balance -= amount
            state.record_history(hour, amount, ev["device"], ev["location"], ev["recipient"], ev["category"])


def generate_dataset(n_customers=1800, days=75, seed=42, label_noise=0.004) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for cid in range(n_customers):
        simulate_customer(cid, rng, days, rows)
    df = pd.DataFrame(rows)
    if label_noise > 0:
        flip = rng.random(len(df)) < label_noise
        df.loc[flip, "is_fraud"] = 1 - df.loc[flip, "is_fraud"]
    return df[FEATURES + ["is_fraud", "customer_id", "ts", "scenario"]]


def main():
    n_customers = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df = generate_dataset(n_customers=n_customers)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"Dataset created: {OUTPUT_FILE}")
    print(f"Rows: {len(df)}  customers: {df['customer_id'].nunique()}  fraud rate: {df['is_fraud'].mean():.2%}")
    print("\nRows per scenario:")
    print(df["scenario"].value_counts().to_string())


if __name__ == "__main__":
    main()
