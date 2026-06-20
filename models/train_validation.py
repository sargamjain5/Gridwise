"""
Validation Outcome Prediction (XGBoost Classifier)
Predicts whether a violation record will be approved or rejected.
Useful for auto-triage of incoming violations.
"""
import pandas as pd
import numpy as np
import json
import joblib
from pathlib import Path
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score

# ---------- PATHS ----------

BASE_DIR = Path(__file__).resolve().parent

CSV_PATH = BASE_DIR / "jan to may police violation_anonymized791b166.csv"

OUT_DIR = BASE_DIR / "trained"

OUT_DIR.mkdir(parents=True, exist_ok=True)

print("CSV:", CSV_PATH)
print("Exists:", CSV_PATH.exists())


def train():
    print("[Validation] Loading data...")
    df = pd.read_csv(CSV_PATH, low_memory=False,
                     usecols=['vehicle_type', 'violation_type', 'police_station', 'junction_name',
                              'created_datetime', 'device_id', 'validation_status'])

    # Only records with known validation outcome
    df = df[df['validation_status'].isin(['approved', 'rejected'])].copy()
    print(f"[Validation] {len(df):,} records with validation outcome")

    df['created_datetime'] = pd.to_datetime(df['created_datetime'], errors='coerce', utc=True)
    df['ist'] = df['created_datetime'] + pd.Timedelta(hours=5, minutes=30)
    df['hour'] = df['ist'].dt.hour
    df['day_of_week'] = df['ist'].dt.dayofweek
    df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)

    # Target
    df['target'] = (df['validation_status'] == 'approved').astype(int)

    # Parse violation type to check for parking
    df['is_parking'] = df['violation_type'].str.contains('PARKING', case=False, na=False).astype(int)
    df['is_wrong_parking'] = df['violation_type'].str.contains('WRONG PARKING', case=False, na=False).astype(int)
    df['is_no_parking'] = df['violation_type'].str.contains('NO PARKING', case=False, na=False).astype(int)
    df['multi_violation'] = df['violation_type'].str.count(',').clip(upper=5)

    # Encode categoricals
    le_vtype = LabelEncoder()
    df['vehicle_type_enc'] = le_vtype.fit_transform(df['vehicle_type'].fillna('UNKNOWN'))

    le_station = LabelEncoder()
    df['station_enc'] = le_station.fit_transform(df['police_station'].fillna('Unknown'))

    le_junction = LabelEncoder()
    df['junction_enc'] = le_junction.fit_transform(df['junction_name'].fillna('Unknown'))

    # Device activity (proxy for device quality)
    device_counts = df['device_id'].value_counts()
    df['device_volume'] = df['device_id'].map(device_counts).fillna(0)

    feature_cols = ['vehicle_type_enc', 'station_enc', 'junction_enc', 'hour', 'day_of_week',
                    'is_weekend', 'is_parking', 'is_wrong_parking', 'is_no_parking',
                    'multi_violation', 'device_volume']

    X = df[feature_cols]
    y = df['target']

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    print(f"[Validation] Train: {len(X_train):,}, Test: {len(X_test):,}")
    print(f"[Validation] Approval rate: {y.mean()*100:.1f}%")

    model = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1,
        eval_metric='auc',
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)
    auc = roc_auc_score(y_test, y_prob)
    report = classification_report(y_test, y_pred, output_dict=True)

    print(f"[Validation] AUC: {auc:.3f}")
    print(classification_report(y_test, y_pred, target_names=['Rejected', 'Approved']))

    # Save
    joblib.dump(model, OUT_DIR / "validation_xgb.joblib")
    joblib.dump(le_vtype, OUT_DIR / "validation_vtype_encoder.joblib")
    joblib.dump(le_station, OUT_DIR / "validation_station_encoder.joblib")

    # Export: per-station approval prediction rates
    station_preds = {}
    for station in df['police_station'].unique():
        mask = df['police_station'] == station
        if mask.sum() < 50:
            continue
        station_X = X[mask]
        probs = model.predict_proba(station_X)[:, 1]
        station_preds[station] = {
            'avgApprovalProb': round(float(probs.mean()), 3),
            'actualApprovalRate': round(float(y[mask].mean()), 3),
            'sampleSize': int(mask.sum()),
        }

    # Per vehicle-type
    vtype_preds = {}
    for vtype in df['vehicle_type'].unique():
        mask = df['vehicle_type'] == vtype
        if mask.sum() < 50:
            continue
        vtype_X = X[mask]
        probs = model.predict_proba(vtype_X)[:, 1]
        vtype_preds[vtype] = {
            'avgApprovalProb': round(float(probs.mean()), 3),
            'actualApprovalRate': round(float(y[mask].mean()), 3),
            'sampleSize': int(mask.sum()),
        }

    output = {
        'model': 'XGBoost Classifier',
        'auc': round(auc, 3),
        'precision': round(report['1']['precision'], 3),
        'recall': round(report['1']['recall'], 3),
        'f1': round(report['1']['f1-score'], 3),
        'train_size': len(X_train),
        'test_size': len(X_test),
        'feature_importance': dict(zip(feature_cols, [round(float(x), 4) for x in model.feature_importances_])),
        'stationPredictions': station_preds,
        'vehicleTypePredictions': vtype_preds,
    }

    with open(OUT_DIR / "validation_predictions.json", 'w') as f:
        json.dump(output, f)

    print(f"[Validation] Saved model + predictions for {len(station_preds)} stations")
    return output


if __name__ == "__main__":
    train()
