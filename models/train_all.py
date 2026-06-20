"""
Train all models and export predictions.
Run: python train_all.py
"""
import time
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

OUT_DIR = BASE_DIR / "trained"

DASHBOARD_PUBLIC = BASE_DIR.parent / "public"

DASHBOARD_PUBLIC.mkdir(parents=True, exist_ok=True)


def main():
    t0 = time.time()
    all_results = {}

    print("=" * 60)
    print("  TRAINING ALL MODELS")
    print("=" * 60)

    # 1. Hotspot
    print("\n" + "─" * 40)
    from train_hotspot import train as train_hotspot
    all_results['hotspot'] = train_hotspot()

    # 2. Offender
    print("\n" + "─" * 40)
    from train_offender import train as train_offender
    all_results['offender'] = train_offender()

    # 3. Anomaly
    print("\n" + "─" * 40)
    from train_anomaly import train as train_anomaly
    all_results['anomaly'] = train_anomaly()

    # 4. Validation
    print("\n" + "─" * 40)
    from train_validation import train as train_validation
    all_results['validation'] = train_validation()

    # 5. Forecast
    print("\n" + "─" * 40)
    from train_forecast import train as train_forecast
    all_results['forecast'] = train_forecast()

    # Merge all predictions into a single JSON for the dashboard
    print("\n" + "─" * 40)
    print("Merging model outputs for dashboard...")

    ml_data = {
        'hotspot': {
            'model': all_results['hotspot']['model'],
            'mae': all_results['hotspot']['mae'],
            'r2': all_results['hotspot']['r2'],
            'featureImportance': all_results['hotspot']['feature_importance'],
            'predictions': all_results['hotspot']['predictions'],
        },
        'offender': {
            'model': all_results['offender']['model'],
            'auc': all_results['offender']['auc'],
            'precision': all_results['offender']['precision'],
            'recall': all_results['offender']['recall'],
            'f1': all_results['offender']['f1'],
            'featureImportance': all_results['offender']['feature_importance'],
            'predictions': all_results['offender']['predictions'],
        },
        'anomaly': {
            'model': all_results['anomaly']['model'],
            'totalAnalyzed': all_results['anomaly']['total_entities_analyzed'],
            'anomaliesDetected': all_results['anomaly']['anomalies_detected'],
            'results': all_results['anomaly']['results'],
        },
        'validation': {
            'model': all_results['validation']['model'],
            'auc': all_results['validation']['auc'],
            'featureImportance': all_results['validation']['feature_importance'],
            'stationPredictions': all_results['validation']['stationPredictions'],
            'vehicleTypePredictions': all_results['validation']['vehicleTypePredictions'],
        },
        'forecast': {
            'model': all_results['forecast']['model'],
            'stations': all_results['forecast']['stations'],
            'results': all_results['forecast']['results'],
        },
    }

    out_path = DASHBOARD_PUBLIC / "ml_models.json"
    with open(out_path, 'w') as f:
        json.dump(ml_data, f)

    size_mb = out_path.stat().st_size / 1e6
    elapsed = time.time() - t0

    print(f"\nSaved: {out_path} ({size_mb:.2f} MB)")
    print(f"\n{'=' * 60}")
    print(f"  ALL MODELS TRAINED IN {elapsed:.1f}s")
    print(f"{'=' * 60}")
    print(f"\n  Hotspot:    MAE={all_results['hotspot']['mae']}, R²={all_results['hotspot']['r2']}")
    print(f"  Offender:   AUC={all_results['offender']['auc']}")
    print(f"  Anomaly:    {all_results['anomaly']['anomalies_detected']} anomalies found")
    print(f"  Validation: AUC={all_results['validation']['auc']}")
    print(f"  Forecast:   {all_results['forecast']['stations']} stations forecasted")


if __name__ == "__main__":
    main()
