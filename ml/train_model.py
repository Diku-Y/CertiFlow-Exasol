"""
Train the initial (v1) fraud model from the behavioural synthetic dataset.

    python generate_dataset.py     # optional - train_model.py generates data when missing
    python train_model.py

Retraining with analyst feedback is done by the running service (POST /retrain,
triggered from the admin console) and keeps every version on disk.
"""
import os
import sys

import pandas as pd

from generate_dataset import OUTPUT_FILE, generate_dataset
from model_store import MODEL_DIR, SEED_DIR, save_bundle, set_current
from training import train_bundle


def load_training_data(n_customers=1800):
    if os.path.exists(OUTPUT_FILE):
        df = pd.read_csv(OUTPUT_FILE)
        print(f"Loaded dataset: {OUTPUT_FILE} ({len(df)} rows)")
        return df
    print("Dataset not found - generating...")
    return generate_dataset(n_customers=n_customers)


def print_metrics(bundle):
    t = bundle["metrics"]["test"]
    print("\n=== HOLD-OUT TEST (customers never seen in training) ===")
    print(f"rows {t['rows']}  fraud {t['fraud_rows']} ({t['fraud_rate']:.2%})")
    print(f"ROC-AUC {t['roc_auc']:.4f}   PR-AUC {t['pr_auc']:.4f}   Brier {t['brier']:.4f}")
    print(f"threshold {bundle['threshold']:.2f}  precision {t['precision']:.3f}  recall {t['recall']:.3f}  "
          f"F1 {t['f1']:.3f}  FPR {t['false_positive_rate']:.4f}")
    print(f"confusion matrix {t['confusion_matrix']}")
    print("\nFlag rate per scenario at the decision threshold:")
    for name, row in t.get("per_scenario", {}).items():
        print(f"  {row['type']:5s} {name:22s} rows={row['rows']:6d}  flagged={row['flagged_rate']:.1%}")
    print("\nTop drivers (permutation importance):")
    for item in bundle["feature_importance"][:8]:
        print(f"  {item['feature']:26s} {item['importance']:.4f}")


def main():
    seed_mode = "--seed" in sys.argv  # bake into the image layer used to initialise an empty volume
    df = load_training_data()
    bundle = train_bundle(df, version=1)
    base = SEED_DIR if seed_mode else MODEL_DIR
    save_bundle(bundle, base)
    set_current(1, base)
    print_metrics(bundle)
    print(f"\nModel v1 saved under {base}")


if __name__ == "__main__":
    main()
