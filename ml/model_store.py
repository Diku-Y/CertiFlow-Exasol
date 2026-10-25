"""
Versioned model registry on disk.

models/
  current.json          {"version": 3}
  v1/bundle.joblib      trained bundle
  v1/summary.json       metrics + training info (no estimator objects)
"""
import json
import os
import shutil

import joblib

MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(__file__), "models"))
SEED_DIR = os.environ.get("SEED_MODEL_DIR", os.path.join(os.path.dirname(__file__), "seed_models"))


def _version_dir(base, version):
    return os.path.join(base, f"v{version}")


def list_versions(base=None):
    base = base or MODEL_DIR
    if not os.path.isdir(base):
        return []
    versions = []
    for name in os.listdir(base):
        if name.startswith("v") and name[1:].isdigit():
            versions.append(int(name[1:]))
    return sorted(versions)


def next_version(base=None):
    versions = list_versions(base)
    return (versions[-1] + 1) if versions else 1


def current_version(base=None):
    base = base or MODEL_DIR
    pointer = os.path.join(base, "current.json")
    if not os.path.exists(pointer):
        return None
    with open(pointer) as fh:
        return int(json.load(fh)["version"])


def set_current(version, base=None):
    base = base or MODEL_DIR
    os.makedirs(base, exist_ok=True)
    tmp = os.path.join(base, "current.json.tmp")
    with open(tmp, "w") as fh:
        json.dump({"version": int(version)}, fh)
    os.replace(tmp, os.path.join(base, "current.json"))


def summary_of(bundle):
    return {
        "version": bundle["version"],
        "parent_version": bundle.get("parent_version"),
        "trained_at": bundle["trained_at"],
        "threshold": bundle["threshold"],
        "metrics": bundle["metrics"],
        "feature_importance": bundle["feature_importance"],
        "training_info": bundle["training_info"],
        "features": bundle["features"],
    }


def save_bundle(bundle, base=None):
    base = base or MODEL_DIR
    vdir = _version_dir(base, bundle["version"])
    os.makedirs(vdir, exist_ok=True)
    joblib.dump(bundle, os.path.join(vdir, "bundle.joblib"), compress=3)
    with open(os.path.join(vdir, "summary.json"), "w") as fh:
        json.dump(summary_of(bundle), fh, indent=2)
    return vdir


def load_bundle(version, base=None):
    base = base or MODEL_DIR
    return joblib.load(os.path.join(_version_dir(base, version), "bundle.joblib"))


def load_summary(version, base=None):
    base = base or MODEL_DIR
    with open(os.path.join(_version_dir(base, version), "summary.json")) as fh:
        return json.load(fh)


def ensure_models_available():
    """Start-up helper: make sure MODEL_DIR has an active model (copy from seed image layer if empty)."""
    if current_version() is not None:
        return
    if os.path.isdir(SEED_DIR) and current_version(SEED_DIR) is not None:
        os.makedirs(MODEL_DIR, exist_ok=True)
        for name in os.listdir(SEED_DIR):
            src, dst = os.path.join(SEED_DIR, name), os.path.join(MODEL_DIR, name)
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
        return
    raise FileNotFoundError("No trained model found. Run `python train_model.py` first.")
