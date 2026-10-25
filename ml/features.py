"""
Reference implementation of CertiFlow's behavioural feature computation.

The training data generator uses this class to build features incrementally,
exactly as the Node backend does at serving time from its Redis behaviour
profile. The definitions are documented in feature_spec.py.
"""
import math
from collections import defaultdict, deque

from feature_spec import CLIP_RANGES, FEATURES

WEEK = 7 * 24 * 3600


def clip(name, value):
    lo_hi = CLIP_RANGES.get(name)
    if not lo_hi:
        return value
    return max(lo_hi[0], min(lo_hi[1], value))


class CustomerState:
    """Behavioural profile of one customer."""

    def __init__(self, account_created_ts: float):
        self.account_created_ts = account_created_ts
        self.count = 0
        self.total = 0.0
        self.total_sq = 0.0
        self.max_amount = 0.0
        self.hours = [0] * 24
        self.devices = set()
        self.locations = set()
        self.recipients = set()
        self.categories = defaultdict(int)
        # (timestamp, amount, status) status: C completed, H held, B blocked, F failed
        self.attempts = deque()

    # ------------------------------------------------------------------ compute
    def compute(self, ts, hour, amount, balance_before, device, location,
                recipient, category, is_p2p, fan_in) -> dict:
        self._prune(ts)
        n = self.count
        mean = (self.total / n) if n else amount
        variance = max((self.total_sq / n) - mean * mean, 0.0) if n else 0.0
        std = math.sqrt(variance)

        c2m = c1h = c24h = c7d = f24h = f10m = 0
        sum24h = 0.0
        last_ts = None
        for (t, a, s) in self.attempts:
            age = ts - t
            if age < 0:
                continue
            c7d += 1
            if age <= 86400:
                c24h += 1
                sum24h += a
                if s == "F":
                    f24h += 1
            if age <= 3600:
                c1h += 1
            if age <= 120:
                c2m += 1
            if age <= 600 and s == "F":
                f10m += 1
            if last_ts is None or t > last_ts:
                last_ts = t

        minutes_since = ((ts - last_ts) / 60.0) if last_ts is not None else 10080.0

        if n:
            h = self.hours
            hour_frequency = (h[(hour - 1) % 24] + h[hour] + h[(hour + 1) % 24]) / n
            category_frequency = self.categories.get(category, 0) / n
            zscore = (amount - mean) / max(std, 0.3 * mean, 1.0)
            max_ratio = amount / max(self.max_amount, 1.0)
            avg_ratio = amount / mean if mean > 0 else 1.0
        else:
            hour_frequency = 0.5
            category_frequency = 0.0
            zscore = 0.0
            max_ratio = 1.0
            avg_ratio = 1.0

        row = {
            "amount": amount,
            "amount_to_avg_ratio": clip("amount_to_avg_ratio", avg_ratio),
            "amount_zscore": clip("amount_zscore", zscore),
            "amount_to_balance_ratio": clip("amount_to_balance_ratio", amount / max(balance_before, 1.0)),
            "amount_to_max_ratio": clip("amount_to_max_ratio", max_ratio),
            "history_txn_count": n,
            "account_age_days": clip("account_age_days", max(0.0, (ts - self.account_created_ts) / 86400.0)),
            "txns_last_1h": c1h,
            "txns_last_24h": c24h,
            "txns_last_7d": c7d,
            "velocity_2m": c2m,
            "amount_sum_24h_ratio": clip("amount_sum_24h_ratio", sum24h / max(mean, 1.0)),
            "minutes_since_last_txn": clip("minutes_since_last_txn", minutes_since),
            "known_device": int(device in self.devices),
            "known_location": int(location in self.locations),
            "known_recipient": int(recipient in self.recipients),
            "unique_device_count": len(self.devices),
            "unique_location_count": len(self.locations),
            "hour_sin": math.sin(2 * math.pi * hour / 24.0),
            "hour_cos": math.cos(2 * math.pi * hour / 24.0),
            "hour_frequency": hour_frequency,
            "is_night": int(hour < 6),
            "category_frequency": category_frequency,
            "is_p2p": int(is_p2p),
            "recipient_fan_in_24h": fan_in,
            "failed_last_24h": f24h,
            "failed_last_10m": f10m,
            "is_round_amount": int(amount >= 1000 and amount % 500 == 0),
        }
        return {name: float(row[name]) for name in FEATURES}

    # ------------------------------------------------------------------- update
    def record_attempt(self, ts, amount, status):
        self.attempts.append((ts, amount, status))

    def record_history(self, hour, amount, device, location, recipient, category):
        """Called only for COMPLETED debit transactions."""
        self.count += 1
        self.total += amount
        self.total_sq += amount * amount
        self.max_amount = max(self.max_amount, amount)
        self.hours[hour] += 1
        self.devices.add(device)
        self.locations.add(location)
        self.recipients.add(recipient)
        self.categories[category] += 1

    def _prune(self, ts):
        while self.attempts and ts - self.attempts[0][0] > WEEK:
            self.attempts.popleft()
