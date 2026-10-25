"""
Run from the ml/ directory:  python -m pytest tests -q   (or: python tests/test_ml.py)
Requires a trained model (python train_model.py).
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd  # noqa: E402

from app import app  # noqa: E402
from feature_spec import FEATURES  # noqa: E402
from features import CustomerState  # noqa: E402

client = app.test_client()

NORMAL = dict(zip(FEATURES, [
    1200, 1.0, 0.2, 0.02, 0.6, 90, 400, 0, 2, 9, 0, 1.0, 600, 1, 1, 1, 1, 1, 0.0, -1.0, 0.3, 0, 0.3, 0, 0, 0, 0, 0]))
ATO = dict(NORMAL, amount=90000, amount_to_avg_ratio=40, amount_zscore=15, amount_to_balance_ratio=0.8,
           amount_to_max_ratio=6, known_device=0, known_location=0, known_recipient=0, is_night=1,
           hour_frequency=0.0, is_p2p=1, recipient_fan_in_24h=4, minutes_since_last_txn=3, txns_last_1h=3,
           velocity_2m=2, category_frequency=0.0, hour_sin=0.98, hour_cos=0.2)


def test_contract_matches_state_machine():
    state = CustomerState(account_created_ts=-100 * 86400)
    row = state.compute(ts=1000, hour=10, amount=500, balance_before=10000, device="d", location="Chennai",
                        recipient="r", category="Food", is_p2p=False, fan_in=0)
    assert list(row.keys()) == FEATURES


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json["status"] == "ok"


def test_normal_is_low_risk_and_ato_is_high_risk():
    normal = client.post("/predict", json={"features": NORMAL}).json
    fraud = client.post("/predict", json={"features": ATO}).json
    assert normal["ml_risk_score"] < 20, normal
    assert fraud["ml_risk_score"] > 60, fraud
    assert fraud["fraud_probability"] > normal["fraud_probability"]
    assert fraud["risk_drivers"], "fraud should come with reason codes"
    names = {d["feature"] for d in fraud["risk_drivers"]}
    assert names & {"known_device", "known_location", "known_recipient", "amount_to_avg_ratio", "amount_zscore"}


def test_validation_errors():
    assert client.post("/predict", json={"features": {"amount": 1}}).status_code == 400
    bad = dict(NORMAL, amount="abc")
    assert client.post("/predict", json={"features": bad}).status_code == 400
    assert client.post("/predict", json={"features": dict(NORMAL, amount=float("inf"))}).status_code in (400,)
    assert client.post("/predict/batch", json={"items": []}).status_code == 400


def test_batch_and_stats_and_drift():
    items = [{"features": NORMAL}] * 40
    r = client.post("/predict/batch", json={"items": items})
    assert r.status_code == 200 and len(r.json["results"]) == 40
    assert client.get("/stats").json["samples"] >= 40
    d = client.get("/drift").json
    assert d["ready"] is True and len(d["features"]) == len(FEATURES)


def test_model_info():
    info = client.get("/model-info").json
    assert info["features"] == FEATURES
    assert info["metrics"]["test"]["pr_auc"] > 0.7
    assert info["versions"]


def test_retrain_cycle_with_feedback():
    import random
    random.seed(1)
    feedback = []
    for _ in range(60):
        feedback.append({"features": dict(NORMAL, amount=random.randint(200, 3000)), "is_fraud": 0})
    for _ in range(30):
        feedback.append({"features": dict(ATO, amount=random.randint(30000, 120000)), "is_fraud": 1})
    assert client.post("/retrain", json={"feedback": feedback[:5]}).status_code == 400
    r = client.post("/retrain", json={"feedback": feedback})
    assert r.status_code == 202, r.json
    assert client.post("/retrain", json={"feedback": feedback}).status_code == 409
    for _ in range(180):
        status = client.get("/retrain/status").json
        if status["state"] in ("done", "failed"):
            break
        time.sleep(1)
    assert status["state"] == "done", status
    assert status["result"]["new_version"] >= 2
    active = client.get("/health").json["model_version"]
    assert active == status["result"]["active_version"]
    # rollback to v1 works
    assert client.post("/rollback", json={"version": 1}).json["version"] == 1
    assert client.post("/rollback", json={"version": 999}).status_code == 404


if __name__ == "__main__":
    try:
        import pytest
        sys.exit(pytest.main([__file__, "-q"]))
    except ImportError:  # minimal runner when pytest is not installed
        failed = 0
        for name, fn in list(globals().items()):
            if name.startswith("test_") and callable(fn):
                try:
                    fn()
                    print(f"PASS {name}")
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    print(f"FAIL {name}: {exc!r}")
        sys.exit(1 if failed else 0)
