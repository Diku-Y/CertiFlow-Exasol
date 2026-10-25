"""
CertiFlow fraud model - feature contract.

This file is the single source of truth for the model's input schema.
The Node backend builds these features from Redis (fast path) or MongoDB
(fallback path) and the training pipeline builds them with features.py.
The backend calls GET /model-info at start-up and warns if its own
feature list differs from FEATURES below (train/serve skew guard).

Definitions (all "history" means the customer's COMPLETED debit transactions,
so blocked / held fraud attempts never pollute the behavioural baseline;
all "attempts" means every scored or failed attempt regardless of outcome):

amount                   transfer / payment amount in INR
amount_to_avg_ratio      amount / mean(history amounts)              (1.0 when no history)
amount_zscore            (amount - mean) / max(std, 0.3*mean, 1)     clipped to [-5, 20] (0 when no history)
amount_to_balance_ratio  amount / balance before the payment         clipped to [0, 1]
amount_to_max_ratio      amount / max(history amounts)               (1.0 when no history)
history_txn_count        number of history transactions
account_age_days         days since the account was opened           capped at 3650
txns_last_1h             attempts in the last hour (excluding this one)
txns_last_24h            attempts in the last 24 hours
txns_last_7d             attempts in the last 7 days
velocity_2m              attempts in the last 2 minutes
amount_sum_24h_ratio     sum(amounts of attempts in 24h) / max(mean, 1)  capped at 50
minutes_since_last_txn   minutes since the previous attempt          capped at 10080
known_device             device id seen in history (0/1)
known_location           location seen in history (0/1)
known_recipient          recipient (account or merchant) seen in history (0/1)
unique_device_count      distinct devices in history
unique_location_count    distinct locations in history
hour_sin, hour_cos       cyclical encoding of the local hour (Asia/Kolkata)
hour_frequency           share of history within +-1 hour of the current hour (0.5 when no history)
is_night                 local hour in 00:00-05:59 (0/1)
category_frequency       share of history in the same spending category (0 when no history)
is_p2p                   1 = transfer to another person, 0 = merchant payment
recipient_fan_in_24h     distinct OTHER senders paying the same recipient in 24h (0 for merchants)
failed_last_24h          failed attempts in the last 24 hours
failed_last_10m          failed attempts in the last 10 minutes
is_round_amount          amount >= 1000 and amount % 500 == 0 (0/1)
"""

FEATURES = [
    "amount",
    "amount_to_avg_ratio",
    "amount_zscore",
    "amount_to_balance_ratio",
    "amount_to_max_ratio",
    "history_txn_count",
    "account_age_days",
    "txns_last_1h",
    "txns_last_24h",
    "txns_last_7d",
    "velocity_2m",
    "amount_sum_24h_ratio",
    "minutes_since_last_txn",
    "known_device",
    "known_location",
    "known_recipient",
    "unique_device_count",
    "unique_location_count",
    "hour_sin",
    "hour_cos",
    "hour_frequency",
    "is_night",
    "category_frequency",
    "is_p2p",
    "recipient_fan_in_24h",
    "failed_last_24h",
    "failed_last_10m",
    "is_round_amount",
]

# Human readable names and explanation templates for reason codes.
# {v} is replaced with the raw feature value.
FEATURE_LABELS = {
    "amount": ("Transaction amount", "Amount of INR {v:,.0f}"),
    "amount_to_avg_ratio": ("Amount vs. usual spend", "Amount is {v:.1f}x the customer's average"),
    "amount_zscore": ("Amount deviation", "Amount is {v:.1f} standard deviations above normal"),
    "amount_to_balance_ratio": ("Share of balance", "Payment uses {pct:.0f}% of the available balance"),
    "amount_to_max_ratio": ("Amount vs. largest payment", "Amount is {v:.1f}x the customer's largest past payment"),
    "history_txn_count": ("Thin history", "Only {v:.0f} past transactions to learn behaviour from"),
    "account_age_days": ("Account age", "Account is only {v:.0f} days old"),
    "txns_last_1h": ("Hourly activity", "{v:.0f} attempts in the last hour"),
    "txns_last_24h": ("Daily activity", "{v:.0f} attempts in the last 24 hours"),
    "txns_last_7d": ("Weekly activity", "{v:.0f} attempts in the last 7 days"),
    "velocity_2m": ("Rapid attempts", "{v:.0f} attempts within the last 2 minutes"),
    "amount_sum_24h_ratio": ("24h money moved", "Money moved in 24h is {v:.1f}x the usual payment"),
    "minutes_since_last_txn": ("Time since last attempt", "Only {v:.0f} minutes since the previous attempt"),
    "known_device": ("Unrecognised device", "Payment made from a device not seen before"),
    "known_location": ("Unusual location", "Payment made from a location not seen before"),
    "known_recipient": ("New recipient", "First payment to this recipient"),
    "unique_device_count": ("Device count", "{v:.0f} distinct devices on record"),
    "unique_location_count": ("Location count", "{v:.0f} distinct locations on record"),
    "hour_sin": ("Time of day", "Unusual time of day"),
    "hour_cos": ("Time of day", "Unusual time of day"),
    "hour_frequency": ("Unusual hour", "Customer rarely transacts at this hour"),
    "is_night": ("Night-time activity", "Payment made between midnight and 6 AM"),
    "category_frequency": ("Unusual category", "Customer rarely spends in this category"),
    "is_p2p": ("Person-to-person", "Transfer to an individual account"),
    "recipient_fan_in_24h": ("Recipient fan-in", "Recipient received money from {v:.0f} other senders in 24h"),
    "failed_last_24h": ("Failed attempts (24h)", "{v:.0f} failed attempts in the last 24 hours"),
    "failed_last_10m": ("Recent failures", "{v:.0f} failed attempts in the last 10 minutes"),
    "is_round_amount": ("Round amount", "Suspiciously round amount"),
}

# For explanation purposes, hour_sin / hour_cos are merged into one "time of day" driver.
MERGED_DRIVERS = {"hour_sin": "hour_frequency", "hour_cos": "hour_frequency"}

CLIP_RANGES = {
    "amount_zscore": (-5.0, 20.0),
    "amount_to_balance_ratio": (0.0, 1.0),
    "account_age_days": (0.0, 3650.0),
    "amount_sum_24h_ratio": (0.0, 50.0),
    "minutes_since_last_txn": (0.0, 10080.0),
    "amount_to_avg_ratio": (0.0, 100.0),
    "amount_to_max_ratio": (0.0, 20.0),
}
