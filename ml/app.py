"""
CertiFlow fraud-scoring service.

Endpoints
  GET  /health              liveness + active model version
  GET  /model-info          active model: metrics, feature importance, versions, retrain state
  GET  /features            the feature contract
  POST /predict             score one transaction  -> probability, anomaly percentile, risk score, reason codes
  POST /predict/batch       score many
  GET  /stats               live serving statistics (latency, score distribution)
  GET  /drift               population stability index of live features vs. training data
  POST /retrain             champion/challenger retraining with analyst feedback (async)
  GET  /retrain/status
  POST /rollback            re-activate an older model version

If ML_API_KEY is set, every endpoint except /health requires the X-Service-Key header.
Run with a single gunicorn worker (threads for concurrency) because the active model
lives in process memory and retraining hot-swaps it.
"""
import bisect
import math
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

import model_store
from feature_spec import FEATURE_LABELS, FEATURES
from generate_dataset import generate_dataset
from training import (evaluate, hour_from_trig, percentile_from_quantiles, split_customers,
                      split_feedback, train_bundle)

API_KEY = os.environ.get("ML_API_KEY", "")
STARTED_AT = time.time()

app = Flask(__name__)
lock = threading.RLock()

STATE = {
    "bundle": None,
    "loaded_at": None,
    "live": deque(maxlen=2000),          # (latency_ms, probability, anomaly, risk_score)
    "drift_counts": {},                  # feature -> list[int]
    "drift_samples": 0,
    "predictions": 0,
}
RETRAIN = {"state": "idle", "started_at": None, "finished_at": None, "result": None, "error": None}

GROUPS = {f: [f] for f in FEATURES if f not in ("hour_sin", "hour_cos")}
GROUPS["time_of_day"] = ["hour_sin", "hour_cos"]

PROTECTIVE = {
    "known_device": "Recognised device",
    "known_location": "Familiar location",
    "known_recipient": "Existing recipient",
    "time_of_day": "Typical time of day",
    "hour_frequency": "Customer often transacts at this hour",
    "category_frequency": "Customer often spends in this category",
    "amount_to_avg_ratio": "Amount in line with usual spending",
    "amount_zscore": "Amount in line with usual spending",
    "history_txn_count": "Established transaction history",
    "account_age_days": "Established account",
}


# ----------------------------------------------------------------------------- state
def activate(bundle):
    with lock:
        STATE["bundle"] = bundle
        STATE["loaded_at"] = datetime.now(timezone.utc).isoformat()
        STATE["drift_counts"] = {f: [0] * (len(bundle["drift_reference"][f]["edges"]) - 1) for f in FEATURES}
        STATE["drift_samples"] = 0


def init_state():
    model_store.ensure_models_available()
    version = model_store.current_version()
    activate(model_store.load_bundle(version))


def require_key():
    if API_KEY and request.headers.get("X-Service-Key") != API_KEY:
        return jsonify({"message": "Invalid or missing service key"}), 401
    return None


@app.before_request
def guard():
    if request.path in ("/", "/health"):
        return None
    return require_key()


# ---------------------------------------------------------------------------- scoring
def parse_features(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    data = payload.get("features", payload)
    missing = [f for f in FEATURES if f not in data]
    if missing:
        raise ValueError(f"Missing features: {', '.join(missing)}")
    values = []
    for f in FEATURES:
        try:
            v = float(data[f])
        except (TypeError, ValueError):
            raise ValueError(f"Feature '{f}' must be numeric")
        if not math.isfinite(v):
            raise ValueError(f"Feature '{f}' must be finite")
        values.append(v)
    return values


def fmt_detail(group, row):
    if group == "time_of_day":
        hour = hour_from_trig(row["hour_sin"], row["hour_cos"])
        return "Time of day", f"Unusual time of day ({hour:02d}:00)"
    label, template = FEATURE_LABELS[group]
    value = row[group]
    return label, template.format(v=value, pct=value * 100.0)


def raw_margin(model, frame):
    """Mean raw log-odds of the boosted trees inside the calibrated ensemble (does not saturate like probabilities)."""
    margins = []
    for calibrated in model.calibrated_classifiers_:
        estimator = getattr(calibrated, "estimator", None) or getattr(calibrated, "base_estimator")
        margins.append(estimator.decision_function(frame))
    return np.mean(margins, axis=0)


def explain(bundle, values, p_full):
    """
    Reason codes by sequential peeling on the raw log-odds margin.

    Repeatedly replace the signal whose removal lowers the margin the most with the value of a
    typical legitimate customer and record the drop. Unlike one-at-a-time occlusion this still
    works when several signals overlap (new device + new location + night-time all pushing the
    score), and unlike probabilities the margin does not saturate at 100%.
    `impact` is that signal's share (%) of the total risk signal, so the list sums to <= 100.
    """
    row = dict(zip(FEATURES, values))
    base = bundle["baseline"]
    model = bundle["model"]

    def explainable(name):
        # context features are not "reasons": only surface thin history / young accounts when they really are
        if name in ("is_p2p", "unique_device_count", "unique_location_count"):
            return False
        if name == "history_txn_count":
            return row[name] < 15
        if name == "account_age_days":
            return row[name] < 60
        return True

    names_all = [name for name in GROUPS.keys() if explainable(name)]

    def variant_with(current, name):
        variant = dict(current)
        for f in GROUPS[name]:
            variant[f] = base[f]
        return variant

    margin_full = float(raw_margin(model, pd.DataFrame([row], columns=FEATURES))[0])
    all_removed = dict(row)
    for name in names_all:
        all_removed = variant_with(all_removed, name)
    margin_base = float(raw_margin(model, pd.DataFrame([all_removed], columns=FEATURES))[0])
    total = margin_full - margin_base

    drivers = []
    if total >= 0.5:
        remaining = list(names_all)
        current = dict(row)
        margin_current = margin_full
        for _ in range(6):
            if not remaining:
                break
            variants = [variant_with(current, name) for name in remaining]
            margins = raw_margin(model, pd.DataFrame(variants, columns=FEATURES))
            best = int(np.argmin(margins))
            delta = float(margin_current - margins[best])
            if delta < max(0.1, 0.03 * total):
                break
            name = remaining.pop(best)
            current = variant_with(current, name)
            label, detail = fmt_detail(name, row)
            drivers.append({"feature": name, "label": label, "detail": detail,
                            "impact": round(delta / total * 100.0, 1), "value": row.get(name)})
            margin_current = float(margins[best])

    driver_names = {d["feature"] for d in drivers}
    protective = []
    for name, label in PROTECTIVE.items():
        if name in driver_names:
            continue
        value = row.get(name)
        good = (
            (name in ("known_device", "known_location", "known_recipient") and value == 1)
            or (name in ("amount_to_avg_ratio", "amount_zscore") and row["amount_to_avg_ratio"] < 1.5 and row["amount_zscore"] < 1)
            or (name == "history_txn_count" and value >= 20)
            or (name == "account_age_days" and value >= 180)
        )
        if good and label not in {p["label"] for p in protective}:
            protective.append({"feature": name, "label": label, "impact": None, "value": value})
    return drivers, protective[:4]


def score_one(values, with_explanation=True):
    started = time.perf_counter()
    bundle = STATE["bundle"]
    frame = pd.DataFrame([values], columns=FEATURES)
    probability = float(bundle["model"].predict_proba(frame)[0][1])
    anomaly_raw = float(-bundle["anomaly_model"].decision_function(frame)[0])
    anomaly = percentile_from_quantiles(anomaly_raw, bundle["anomaly_quantiles"])
    tail = min(1.0, max(0.0, (anomaly - 97.0) / 3.0))
    risk_score = int(round(min(100.0, max(0.0, 100.0 * (0.9 * probability + 0.1 * tail)))))
    drivers, protective = ([], [])
    if with_explanation and probability >= 0.02:
        drivers, protective = explain(bundle, values, probability)
    latency_ms = (time.perf_counter() - started) * 1000.0
    return {
        "prediction": int(probability >= bundle["threshold"]),
        "fraud_probability": round(probability, 4),
        "anomaly_score": round(anomaly, 1),
        "ml_risk_score": risk_score,
        "threshold": round(bundle["threshold"], 3),
        "model_version": bundle["version"],
        "risk_drivers": drivers,
        "protective_factors": protective,
        "latency_ms": round(latency_ms, 1),
    }


def track(values, result):
    bundle = STATE["bundle"]
    with lock:
        STATE["predictions"] += 1
        STATE["live"].append((result["latency_ms"], result["fraud_probability"],
                              result["anomaly_score"], result["ml_risk_score"]))
        STATE["drift_samples"] += 1
        for f, v in zip(FEATURES, values):
            edges = bundle["drift_reference"][f]["edges"]
            idx = min(max(bisect.bisect_right(edges, v) - 1, 0), len(edges) - 2)
            STATE["drift_counts"][f][idx] += 1


# --------------------------------------------------------------------------- endpoints
@app.get("/")
@app.get("/health")
def health():
    bundle = STATE["bundle"]
    return jsonify({
        "status": "ok" if bundle else "starting",
        "service": "CertiFlow fraud ML service",
        "model_version": bundle["version"] if bundle else None,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "predictions_served": STATE["predictions"],
    })


@app.get("/features")
def features():
    return jsonify({"features": FEATURES, "labels": {f: FEATURE_LABELS[f][0] for f in FEATURES}})


@app.get("/model-info")
def model_info():
    bundle = STATE["bundle"]
    versions = []
    for v in model_store.list_versions():
        try:
            s = model_store.load_summary(v)
            test = s["metrics"]["test"]
            versions.append({"version": v, "trained_at": s["trained_at"], "pr_auc": test["pr_auc"],
                             "roc_auc": test["roc_auc"], "recall": test["recall"], "precision": test["precision"],
                             "feedback_rows": s["training_info"]["feedback_rows"],
                             "active": v == bundle["version"]})
        except Exception:
            continue
    return jsonify({
        "version": bundle["version"],
        "parent_version": bundle.get("parent_version"),
        "trained_at": bundle["trained_at"],
        "loaded_at": STATE["loaded_at"],
        "threshold": bundle["threshold"],
        "features": FEATURES,
        "metrics": bundle["metrics"],
        "feature_importance": bundle["feature_importance"],
        "training_info": bundle["training_info"],
        "versions": versions,
        "retrain": RETRAIN,
    })


@app.post("/predict")
def predict():
    try:
        values = parse_features(request.get_json(silent=True))
    except ValueError as error:
        return jsonify({"message": str(error)}), 400
    try:
        result = score_one(values)
        track(values, result)
        return jsonify(result)
    except Exception as error:  # pragma: no cover
        app.logger.exception("prediction failed")
        return jsonify({"message": "ML prediction failed", "error": str(error)}), 500


@app.post("/predict/batch")
def predict_batch():
    payload = request.get_json(silent=True) or {}
    items = payload.get("items")
    if not isinstance(items, list) or not items or len(items) > 500:
        return jsonify({"message": "items must be a non-empty list (max 500)"}), 400
    results = []
    for index, item in enumerate(items):
        try:
            values = parse_features(item)
        except ValueError as error:
            return jsonify({"message": f"item {index}: {error}"}), 400
        result = score_one(values, with_explanation=False)
        track(values, result)
        results.append(result)
    return jsonify({"results": results})


@app.get("/stats")
def stats():
    with lock:
        live = list(STATE["live"])
    if not live:
        return jsonify({"samples": 0, "predictions_served": STATE["predictions"]})
    arr = np.array(live)
    hist, _ = np.histogram(arr[:, 3], bins=[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100.0001])
    bundle = STATE["bundle"]
    return jsonify({
        "samples": len(live),
        "predictions_served": STATE["predictions"],
        "latency_ms": {"avg": round(float(arr[:, 0].mean()), 1), "p50": round(float(np.percentile(arr[:, 0], 50)), 1),
                       "p95": round(float(np.percentile(arr[:, 0], 95)), 1)},
        "avg_fraud_probability": round(float(arr[:, 1].mean()), 4),
        "flag_rate": round(float((arr[:, 1] >= bundle["threshold"]).mean()), 4),
        "score_histogram": [{"range": f"{i * 10}-{i * 10 + 10}", "count": int(c)} for i, c in enumerate(hist)],
    })


@app.get("/drift")
def drift():
    bundle = STATE["bundle"]
    with lock:
        counts = {f: list(c) for f, c in STATE["drift_counts"].items()}
        samples = STATE["drift_samples"]
    if samples < 30:
        return jsonify({"samples": samples, "ready": False,
                        "message": "At least 30 live predictions are needed for a meaningful drift estimate."})
    eps = 1e-4
    features = []
    for f in FEATURES:
        ref = bundle["drift_reference"][f]["proportions"]
        live = np.array(counts[f], dtype=float)
        live_p = live / max(live.sum(), 1.0)
        psi = float(sum((lp - rp) * math.log((lp + eps) / (rp + eps)) for lp, rp in zip(live_p, ref)))
        status = "stable" if psi < 0.1 else ("moderate" if psi < 0.25 else "significant")
        features.append({"feature": f, "label": FEATURE_LABELS[f][0], "psi": round(psi, 4), "status": status})
    features.sort(key=lambda d: d["psi"], reverse=True)
    worst = features[0]["psi"]
    overall = "stable" if worst < 0.1 else ("moderate" if worst < 0.25 else "significant")
    return jsonify({"samples": samples, "ready": True, "overall": overall, "features": features})


# ------------------------------------------------------------------------- retraining
def _load_synthetic():
    path = os.path.join(os.path.dirname(__file__), "data", "transactions.csv")
    if os.path.exists(path):
        return pd.read_csv(path)
    return generate_dataset()


def _retrain_job(feedback_df):
    try:
        champion = STATE["bundle"]
        synthetic = _load_synthetic()
        challenger = train_bundle(synthetic, feedback=feedback_df, version=model_store.next_version(),
                                  parent_version=champion["version"])

        _, _, test_c = split_customers(synthetic["customer_id"].values, challenger["training_info"]["seed"])
        test = synthetic[synthetic["customer_id"].isin(test_c)]
        champ_test = evaluate(champion["model"], test, champion["threshold"])
        chall_test = challenger["metrics"]["test"]

        _, fb_holdout = split_feedback(feedback_df, challenger["training_info"]["seed"])
        champ_fb = chall_fb = None
        if fb_holdout["is_fraud"].nunique() > 1:
            champ_fb = evaluate(champion["model"], fb_holdout, champion["threshold"])
            chall_fb = challenger["metrics"].get("feedback_holdout")

        reasons = []
        promoted = True
        if chall_test["pr_auc"] < champ_test["pr_auc"] - 0.01:
            promoted = False
            reasons.append(f"PR-AUC on the synthetic hold-out dropped ({champ_test['pr_auc']:.3f} -> {chall_test['pr_auc']:.3f}).")
        if champ_fb and chall_fb and chall_fb["pr_auc"] < champ_fb["pr_auc"] - 0.005:
            promoted = False
            reasons.append(f"PR-AUC on real analyst feedback dropped ({champ_fb['pr_auc']:.3f} -> {chall_fb['pr_auc']:.3f}).")
        if promoted:
            reasons.append("Challenger matched or beat the champion on every comparison.")

        model_store.save_bundle(challenger)
        if promoted:
            model_store.set_current(challenger["version"])
            activate(challenger)

        RETRAIN.update(state="done", finished_at=datetime.now(timezone.utc).isoformat(), error=None, result={
            "promoted": promoted,
            "new_version": challenger["version"],
            "active_version": STATE["bundle"]["version"],
            "reasons": reasons,
            "champion": {"version": champion["version"], "synthetic_test": _brief(champ_test), "feedback_holdout": _brief(champ_fb)},
            "challenger": {"version": challenger["version"], "synthetic_test": _brief(chall_test),
                           "feedback_holdout": _brief(chall_fb)},
            "feedback_rows": challenger["training_info"]["feedback_rows"],
        })
    except Exception as error:  # pragma: no cover
        app.logger.exception("retrain failed")
        RETRAIN.update(state="failed", finished_at=datetime.now(timezone.utc).isoformat(), error=str(error))


def _brief(m):
    if not m:
        return None
    return {k: m[k] for k in ("rows", "fraud_rows", "pr_auc", "roc_auc", "precision", "recall", "f1")}


@app.post("/retrain")
def retrain():
    if RETRAIN["state"] == "running":
        return jsonify({"message": "A retraining job is already running"}), 409
    payload = request.get_json(silent=True) or {}
    items = payload.get("feedback")
    if not isinstance(items, list):
        return jsonify({"message": "feedback must be a list of {features, is_fraud}"}), 400
    rows = []
    try:
        for item in items:
            values = parse_features(item)
            label = int(item["is_fraud"])
            if label not in (0, 1):
                raise ValueError("is_fraud must be 0 or 1")
            rows.append(dict(zip(FEATURES, values), is_fraud=label, scenario="feedback"))
    except (ValueError, KeyError, TypeError) as error:
        return jsonify({"message": f"Invalid feedback: {error}"}), 400
    frame = pd.DataFrame(rows)
    if len(frame) < 20 or frame["is_fraud"].sum() < 3 or (frame["is_fraud"] == 0).sum() < 3:
        return jsonify({"message": "Need at least 20 labelled rows with 3+ fraud and 3+ legitimate examples."}), 400
    RETRAIN.update(state="running", started_at=datetime.now(timezone.utc).isoformat(), finished_at=None,
                   result=None, error=None)
    threading.Thread(target=_retrain_job, args=(frame,), daemon=True).start()
    return jsonify({"message": "Retraining started", "feedback_rows": len(frame)}), 202


@app.get("/retrain/status")
def retrain_status():
    return jsonify(RETRAIN)


@app.post("/rollback")
def rollback():
    payload = request.get_json(silent=True) or {}
    try:
        version = int(payload.get("version"))
    except (TypeError, ValueError):
        return jsonify({"message": "version is required"}), 400
    if version not in model_store.list_versions():
        return jsonify({"message": f"Model version {version} does not exist"}), 404
    bundle = model_store.load_bundle(version)
    model_store.set_current(version)
    activate(bundle)
    return jsonify({"message": f"Model v{version} is now active", "version": version})


init_state()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False, threaded=True)
