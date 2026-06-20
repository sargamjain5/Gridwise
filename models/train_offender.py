"""
Offender Re-offense Prediction Model (XGBoost Classifier)
Features: violation history, frequency, station spread, violation types, temporal patterns
Target: will this vehicle commit another violation within 30 days?
"""
import pandas as pd
import numpy as np
import json
import joblib
from pathlib import Path
from xgboost import XGBClassifier
from sklearn.metrics import classification_report, roc_auc_score

# ---------- PATHS ----------

BASE_DIR = Path(__file__).resolve().parent

CSV_PATH = BASE_DIR / "jan to may police violation_anonymized791b166.csv"

OUT_DIR = BASE_DIR / "trained"

OUT_DIR.mkdir(parents=True, exist_ok=True)

print("CSV:", CSV_PATH)
print("Exists:", CSV_PATH.exists())


def train():
    print("[Offender] Loading data...")
    df = pd.read_csv(CSV_PATH, low_memory=False,
                     usecols=['vehicle_number', 'vehicle_type', 'violation_type', 'created_datetime',
                              'police_station', 'junction_name', 'latitude', 'longitude', 'validation_status'])

    df['created_datetime'] = pd.to_datetime(df['created_datetime'], errors='coerce', utc=True)
    df = df.dropna(subset=['created_datetime', 'vehicle_number'])
    df['ist'] = df['created_datetime'] + pd.Timedelta(hours=5, minutes=30)
    df = df.sort_values('ist')

    print(f"[Offender] {len(df):,} records")

    # Split point: use first 3.5 months for features, last 1.5 months for labels
    cutoff = df['ist'].min() + pd.Timedelta(days=105)  # ~3.5 months
    label_end = df['ist'].max()

    train_df = df[df['ist'] <= cutoff]
    label_df = df[(df['ist'] > cutoff) & (df['ist'] <= cutoff + pd.Timedelta(days=30))]

    print(f"[Offender] Feature window: {train_df['ist'].min().date()} to {train_df['ist'].max().date()}")
    print(f"[Offender] Label window: {label_df['ist'].min().date()} to {label_df['ist'].max().date()}")

    # Build per-vehicle features from training window
    def build_features(vdf):
        feats = {}

        # Total violations
        feats['total_violations'] = len(vdf)

        # Violation frequency (per 30 days)
        span_days = max(1, (vdf['ist'].max() - vdf['ist'].min()).days)
        feats['freq_per_month'] = feats['total_violations'] / span_days * 30

        # Unique stations
        feats['station_count'] = vdf['police_station'].nunique()

        # Unique junctions
        feats['junction_count'] = vdf['junction_name'].nunique()

        # Vehicle type (encode top types)
        vtype = vdf['vehicle_type'].mode()
        feats['is_car'] = 1 if len(vtype) > 0 and vtype.iloc[0] == 'CAR' else 0
        feats['is_scooter'] = 1 if len(vtype) > 0 and vtype.iloc[0] == 'SCOOTER' else 0
        feats['is_motorcycle'] = 1 if len(vtype) > 0 and vtype.iloc[0] == 'MOTOR CYCLE' else 0
        feats['is_auto'] = 1 if len(vtype) > 0 and vtype.iloc[0] == 'PASSENGER AUTO' else 0

        # Parking violation ratio
        parking_count = vdf['violation_type'].str.contains('PARKING', case=False, na=False).sum()
        feats['parking_ratio'] = parking_count / feats['total_violations']

        # Time patterns
        feats['avg_hour'] = vdf['ist'].dt.hour.mean()
        feats['hour_std'] = vdf['ist'].dt.hour.std() if len(vdf) > 1 else 0

        # Weekend ratio
        feats['weekend_ratio'] = (vdf['ist'].dt.dayofweek >= 5).mean()

        # Geographic spread
        feats['lat_std'] = vdf['latitude'].std() if len(vdf) > 1 else 0
        feats['lon_std'] = vdf['longitude'].std() if len(vdf) > 1 else 0

        # Recency: days since last violation in training window
        feats['recency_days'] = (cutoff - vdf['ist'].max()).days

        # Escalation: compare first half vs second half rate
        if len(vdf) >= 4:
            mid = len(vdf) // 2
            first_span = max(1, (vdf.iloc[mid - 1]['ist'] - vdf.iloc[0]['ist']).days)
            second_span = max(1, (vdf.iloc[-1]['ist'] - vdf.iloc[mid]['ist']).days)
            feats['escalation'] = (mid / first_span) / ((len(vdf) - mid) / second_span + 0.001)
        else:
            feats['escalation'] = 1.0

        # Validation rejection rate
        validated = vdf['validation_status'].notna()
        if validated.sum() > 0:
            feats['rejection_rate'] = (vdf.loc[validated.values, 'validation_status'] == 'rejected').mean()
        else:
            feats['rejection_rate'] = 0.0

        return feats

    # Build features for vehicles with 2+ violations
    vehicle_groups = train_df.groupby('vehicle_number')
    vehicles_with_multiple = [v for v, g in vehicle_groups if len(g) >= 2]

    print(f"[Offender] Building features for {len(vehicles_with_multiple):,} vehicles...")

    # Vehicles that re-offended in label window
    label_vehicles = set(label_df['vehicle_number'].unique())

    rows = []
    for vehicle in vehicles_with_multiple:
        group = vehicle_groups.get_group(vehicle)
        feats = build_features(group)
        feats['vehicle'] = vehicle
        feats['re_offended'] = 1 if vehicle in label_vehicles else 0
        rows.append(feats)

    feat_df = pd.DataFrame(rows)
    print(f"[Offender] {len(feat_df):,} samples, {feat_df['re_offended'].sum():,} positive ({feat_df['re_offended'].mean()*100:.1f}%)")

    # Features
    feature_cols = ['total_violations', 'freq_per_month', 'station_count', 'junction_count',
                    'is_car', 'is_scooter', 'is_motorcycle', 'is_auto',
                    'parking_ratio', 'avg_hour', 'hour_std', 'weekend_ratio',
                    'lat_std', 'lon_std', 'recency_days', 'escalation', 'rejection_rate']

    X = feat_df[feature_cols].fillna(0)
    y = feat_df['re_offended']

    # Random split (stratified)
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    print(f"[Offender] Train: {len(X_train):,}, Test: {len(X_test):,}")

    # Train
    model = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        scale_pos_weight=len(y_train[y_train == 0]) / max(1, len(y_train[y_train == 1])),
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1,
        eval_metric='auc',
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    # Evaluate
    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)
    auc = roc_auc_score(y_test, y_prob)
    report = classification_report(y_test, y_pred, output_dict=True)

    print(f"[Offender] AUC: {auc:.3f}")
    print(classification_report(y_test, y_pred, target_names=['No re-offense', 'Re-offense']))

    # Save model
    joblib.dump(model, OUT_DIR / "offender_xgb.joblib")

    # Score ALL vehicles and export
    all_probs = model.predict_proba(X.fillna(0))[:, 1]
    feat_df['reoffense_prob'] = all_probs
    feat_df['risk_score'] = (all_probs * 100).round(0).astype(int)
    feat_df['risk_level'] = pd.cut(feat_df['risk_score'], bins=[-1, 25, 50, 75, 100],
                                    labels=['low', 'medium', 'high', 'critical'])

    # Export top 500
    export_df = feat_df.nlargest(500, 'risk_score')
    export_records = []
    for _, row in export_df.iterrows():
        export_records.append({
            'vehicle': row['vehicle'],
            'riskScore': int(row['risk_score']),
            'riskLevel': row['risk_level'],
            'reoffenseProb': round(float(row['reoffense_prob']), 3),
            'totalViolations': int(row['total_violations']),
            'freqPerMonth': round(float(row['freq_per_month']), 1),
            'stationCount': int(row['station_count']),
            'parkingRatio': round(float(row['parking_ratio']), 2),
            'escalation': round(float(row['escalation']), 2),
            'recencyDays': int(row['recency_days']),
            'factors': {
                'total_violations': round(float(row['total_violations']), 1),
                'freq_per_month': round(float(row['freq_per_month']), 1),
                'station_count': int(row['station_count']),
                'parking_ratio': round(float(row['parking_ratio']), 2),
                'escalation': round(float(row['escalation']), 2),
                'recency_days': int(row['recency_days']),
            },
        })

    output = {
        'model': 'XGBoost Classifier',
        'auc': round(auc, 3),
        'precision': round(report['1']['precision'], 3),
        'recall': round(report['1']['recall'], 3),
        'f1': round(report['1']['f1-score'], 3),
        'train_size': len(X_train),
        'test_size': len(X_test),
        'positive_rate': round(float(y.mean()), 3),
        'feature_importance': dict(zip(feature_cols, [round(float(x), 4) for x in model.feature_importances_])),
        'predictions': export_records,
    }

    with open(OUT_DIR / "offender_predictions.json", 'w') as f:
        json.dump(output, f)

    print(f"[Offender] Saved model + {len(export_records)} vehicle predictions")
    return output


if __name__ == "__main__":
    train()
