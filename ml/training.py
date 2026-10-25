"""
CertiFlow model training.

Model = calibrated HistGradientBoosting classifier (supervised fraud
probability) + IsolationForest trained on legitimate behaviour only
(unsupervised anomaly signal), plus everything the service needs to explain
and monitor itself: decision threshold, anomaly percentile table,
"typical legitimate customer" baseline for reason codes, training-set feature
histograms for drift monitoring, and test-set metrics.

Customers (not rows) are split between fit / validation / test, so the model
is always evaluated on customers it has never seen.
"""
import datetime as dt
import math

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.calibration import CalibratedClassifierCV
from sklearn.inspection import permutation_importance
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,
                             f1_score, precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold

from feature_spec import FEATURES

SCHEMA_VERSION = 2
FEEDBACK_WEIGHT = 4.0
DRIFT_BINS = 10


def _split_customers(customer_ids, seed):
    rng = np.random.default_rng(seed)
    ids = np.array(sorted(set(customer_ids)))
    rng.shuffle(ids)
    n = len(ids)
    n_fit, n_val = int(n * 0.70), int(n * 0.15)
    return set(ids[:n_fit]), set(ids[n_fit:n_fit + n_val]), set(ids[n_fit + n_val:])


def _best_threshold(y_true, proba):
    best_t, best_f1 = 0.5, -1.0
    for t in np.linspace(0.05, 0.95, 91):
        f1 = f1_score(y_true, proba >= t, zero_division=0)
        if f1 > best_f1:
            best_t, best_f1 = float(t), float(f1)
    return best_t, best_f1


def evaluate(model, df, threshold):
    """Metrics for a fitted (calibrated) model on a labelled frame."""
    X, y = df[FEATURES], df["is_fraud"].values
    proba = model.predict_proba(X)[:, 1]
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    out = {
        "rows": int(len(df)),
        "fraud_rows": int(y.sum()),
        "fraud_rate": float(y.mean()),
        "roc_auc": float(roc_auc_score(y, proba)) if 0 < y.sum() < len(y) else None,
        "pr_auc": float(average_precision_score(y, proba)) if y.sum() > 0 else None,
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "brier": float(brier_score_loss(y, proba)),
        "false_positive_rate": float(fp / max(fp + tn, 1)),
        "alert_rate": float(pred.mean()),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }
    if "scenario" in df.columns:
        per = {}
        scen = df["scenario"].values
        for name in sorted(set(scen)):
            mask = scen == name
            if name in ("salary",):
                continue
            flagged = float(pred[mask].mean())
            per[name] = {"rows": int(mask.sum()), "flagged_rate": flagged,
                         "avg_probability": float(proba[mask].mean()),
                         "type": "fraud" if name in _FRAUD_SCENARIOS else "legit"}
        out["per_scenario"] = per
    # reliability curve
    bins = np.linspace(0, 1, 11)
    idx = np.clip(np.digitize(proba, bins) - 1, 0, 9)
    calib = []
    for b in range(10):
        m = idx == b
        if m.sum() >= 20:
            calib.append({"predicted": float(proba[m].mean()), "observed": float(y[m].mean()),
                          "count": int(m.sum())})
    out["calibration"] = calib
    return out


_FRAUD_SCENARIOS = {"ato", "velocity_burst", "app_scam", "slow_drain", "credential_stuffing"}


def _drift_reference(X_fit):
    """Training-time histogram of every feature, used for PSI drift monitoring."""
    ref = {}
    for col in FEATURES:
        values = X_fit[col].values.astype(float)
        uniq = np.unique(values)
        if len(uniq) <= 2:
            mid = float(uniq.mean()) if len(uniq) == 2 else float(uniq[0]) + 0.5
            edges = [-1e18, mid, 1e18]
        else:
            qs = np.unique(np.quantile(values, np.linspace(0, 1, DRIFT_BINS + 1)[1:-1]))
            edges = [-1e18] + [float(q) for q in qs] + [1e18]
        counts, _ = np.histogram(values, bins=edges)
        props = (counts / max(counts.sum(), 1)).tolist()
        ref[col] = {"edges": edges, "proportions": props}
    return ref


def split_customers(customer_ids, seed):
    return _split_customers(customer_ids, seed)


def split_feedback(feedback: pd.DataFrame, seed: int = 42):
    """Deterministic 80/20 split of analyst-labelled rows (fit, holdout)."""
    feedback = feedback.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    cut = int(len(feedback) * 0.8)
    fb_fit, fb_holdout = feedback.iloc[:cut].copy(), feedback.iloc[cut:].copy()
    fb_fit["customer_id"] = -1 - np.arange(len(fb_fit))  # each feedback row is its own group
    return fb_fit, fb_holdout


def train_bundle(df_synthetic: pd.DataFrame, feedback: pd.DataFrame | None = None, seed: int = 42,
                 version: int = 1, parent_version: int | None = None) -> dict:
    """Train a new model bundle. `feedback` holds analyst-labelled real transactions."""
    fit_c, val_c, test_c = _split_customers(df_synthetic["customer_id"].values, seed)
    fit = df_synthetic[df_synthetic["customer_id"].isin(fit_c)].copy()
    val = df_synthetic[df_synthetic["customer_id"].isin(val_c)].copy()
    test = df_synthetic[df_synthetic["customer_id"].isin(test_c)].copy()

    fb_fit = fb_holdout = None
    if feedback is not None and len(feedback) >= 10:
        fb_fit, fb_holdout = split_feedback(feedback, seed)

    train_frame = fit if fb_fit is None else pd.concat([fit, fb_fit], ignore_index=True)
    weights = np.ones(len(train_frame))
    if fb_fit is not None:
        weights[len(fit):] = FEEDBACK_WEIGHT

    X_train, y_train = train_frame[FEATURES], train_frame["is_fraud"].values
    groups = train_frame["customer_id"].values

    base = HistGradientBoostingClassifier(max_iter=220, learning_rate=0.07, max_leaf_nodes=24,
                                          min_samples_leaf=30, l2_regularization=1.0, random_state=seed)
    splits = list(GroupKFold(n_splits=3).split(X_train, y_train, groups))
    model = CalibratedClassifierCV(base, method="isotonic", cv=splits)
    model.fit(X_train, y_train, sample_weight=weights)

    val_proba = model.predict_proba(val[FEATURES])[:, 1]
    threshold, val_f1 = _best_threshold(val["is_fraud"].values, val_proba)

    legit_fit = fit[fit["is_fraud"] == 0][FEATURES]
    anomaly = IsolationForest(n_estimators=200, max_samples=512, contamination="auto",
                              random_state=seed, n_jobs=1).fit(legit_fit)
    legit_val_scores = -anomaly.decision_function(val[val["is_fraud"] == 0][FEATURES])
    anomaly_quantiles = np.quantile(legit_val_scores, np.linspace(0, 1, 1001)).tolist()

    metrics = {"test": evaluate(model, test, threshold), "validation_f1": val_f1}
    if fb_holdout is not None and fb_holdout["is_fraud"].nunique() > 1:
        metrics["feedback_holdout"] = evaluate(model, fb_holdout, threshold)

    # permutation importance on a test sample (average precision)
    sample = test.sample(n=min(6000, len(test)), random_state=seed)
    pi = permutation_importance(model, sample[FEATURES], sample["is_fraud"], scoring="average_precision",
                                n_repeats=2, random_state=seed, n_jobs=1)
    importance = sorted(({"feature": f, "importance": float(max(m, 0.0))}
                         for f, m in zip(FEATURES, pi.importances_mean)),
                        key=lambda d: d["importance"], reverse=True)

    baseline = {f: float(legit_fit[f].median()) for f in FEATURES}

    return {
        "schema_version": SCHEMA_VERSION,
        "version": version,
        "parent_version": parent_version,
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "features": FEATURES,
        "model": model,
        "anomaly_model": anomaly,
        "anomaly_quantiles": anomaly_quantiles,
        "baseline": baseline,
        "threshold": threshold,
        "metrics": metrics,
        "feature_importance": importance,
        "drift_reference": _drift_reference(fit[FEATURES]),
        "training_info": {
            "algorithm": "Calibrated HistGradientBoosting (isotonic, 3-fold grouped) + IsolationForest",
            "synthetic_rows": int(len(df_synthetic)),
            "synthetic_customers": int(df_synthetic["customer_id"].nunique()),
            "feedback_rows": 0 if fb_fit is None else int(len(fb_fit)),
            "feedback_fraud_rows": 0 if fb_fit is None else int(fb_fit["is_fraud"].sum()),
            "fit_rows": int(len(fit)), "validation_rows": int(len(val)), "test_rows": int(len(test)),
            "feedback_weight": FEEDBACK_WEIGHT,
            "seed": seed,
        },
    }


def percentile_from_quantiles(raw_score, quantiles):
    """Map a raw anomaly score to its percentile (0-100) in the legitimate distribution."""
    q = np.asarray(quantiles)
    pct = np.interp(raw_score, q, np.linspace(0, 100, len(q)))
    return float(np.clip(pct, 0.0, 100.0))


def hour_from_trig(sin_v, cos_v):
    angle = math.atan2(sin_v, cos_v)
    return int(round(angle / (2 * math.pi) * 24)) % 24
