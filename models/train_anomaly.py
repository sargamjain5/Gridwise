"""
Anomaly Detection Model (Isolation Forest)
Features: violations_per_day, rejection_rate, geographic_spread, active_hours, station_diversity
Target: anomaly score (unsupervised)
"""
import pandas as pd
import numpy as np
import json
import joblib
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "jan to may police violation_anonymized791b166.csv"
OUT_DIR = BASE_DIR / "trained"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def train():
    print("[Anomaly] Loading data...")
    df = pd.read_csv(CSV_PATH, low_memory=False,
                     usecols=['created_by_id', 'device_id', 'created_datetime', 'police_station',
                              'latitude', 'longitude', 'validation_status'])

    df['created_datetime'] = pd.to_datetime(df['created_datetime'], errors='coerce', utc=True)
    df = df.dropna(subset=['created_datetime'])
    df['ist'] = df['created_datetime'] + pd.Timedelta(hours=5, minutes=30)
    df['date'] = df['ist'].dt.date
    df['hour'] = df['ist'].dt.hour

    results = []

    for entity_type, id_col in [('officer', 'created_by_id'), ('device', 'device_id')]:
        print(f"[Anomaly] Processing {entity_type}s...")
        groups = df.groupby(id_col)

        rows = []
        for entity_id, group in groups:
            if len(group) < 20:
                continue

            active_days = group['date'].nunique()
            violations_per_day = len(group) / max(active_days, 1)

            # Rejection rate
            validated = group['validation_status'].notna()
            if validated.sum() > 0:
                rejection_rate = (group.loc[validated.values, 'validation_status'] == 'rejected').mean()
            else:
                rejection_rate = 0

            # Geographic spread
            lat_std = group['latitude'].astype(float).std() if len(group) > 1 else 0
            lon_std = group['longitude'].astype(float).std() if len(group) > 1 else 0
            geo_spread = np.sqrt(lat_std**2 + lon_std**2) if not np.isnan(lat_std) else 0

            # Active hours spread
            hour_std = group['hour'].std() if len(group) > 1 else 0

            # Station diversity
            station_count = group['police_station'].nunique()

            # Activity concentration: what % of violations happen in their busiest day?
            daily_counts = group.groupby('date').size()
            peak_day_ratio = daily_counts.max() / len(group) if len(group) > 0 else 0

            rows.append({
                'entity_id': entity_id,
                'entity_type': entity_type,
                'total_violations': len(group),
                'active_days': active_days,
                'violations_per_day': violations_per_day,
                'rejection_rate': rejection_rate,
                'geo_spread': geo_spread,
                'hour_std': hour_std,
                'station_count': station_count,
                'peak_day_ratio': peak_day_ratio,
            })

        if not rows:
            continue

        feat_df = pd.DataFrame(rows)
        print(f"[Anomaly] {len(feat_df):,} {entity_type}s with 20+ violations")

        feature_cols = ['violations_per_day', 'rejection_rate', 'geo_spread',
                        'hour_std', 'station_count', 'peak_day_ratio']

        X = feat_df[feature_cols].fillna(0)

        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Train Isolation Forest
        model = IsolationForest(
            n_estimators=200,
            contamination=0.1,  # expect ~10% anomalies
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_scaled)

        # Score
        scores = model.decision_function(X_scaled)  # lower = more anomalous
        # Normalize to 0-100 (inverted: higher = more anomalous)
        min_s, max_s = scores.min(), scores.max()
        normalized = ((max_s - scores) / (max_s - min_s) * 100).round(1)

        feat_df['anomaly_score'] = normalized
        feat_df['is_anomaly'] = model.predict(X_scaled) == -1

        # Save
        joblib.dump(model, OUT_DIR / f"anomaly_{entity_type}_iforest.joblib")
        joblib.dump(scaler, OUT_DIR / f"anomaly_{entity_type}_scaler.joblib")

        anomaly_count = feat_df['is_anomaly'].sum()
        print(f"[Anomaly] {anomaly_count} anomalies detected out of {len(feat_df)}")

        # Export flagged entities
        flagged = feat_df.nlargest(30, 'anomaly_score')
        for _, row in flagged.iterrows():
            flags = []
            if row['violations_per_day'] > feat_df['violations_per_day'].quantile(0.95):
                flags.append(f"Unusually high activity: {row['violations_per_day']:.1f}/day")
            if row['rejection_rate'] > feat_df['rejection_rate'].quantile(0.95):
                flags.append(f"High rejection rate: {row['rejection_rate']*100:.1f}%")
            if row['geo_spread'] > feat_df['geo_spread'].quantile(0.95):
                flags.append(f"Wide geographic spread")
            if row['peak_day_ratio'] > feat_df['peak_day_ratio'].quantile(0.95):
                flags.append(f"Concentrated activity: {row['peak_day_ratio']*100:.0f}% on single day")
            if row['station_count'] > feat_df['station_count'].quantile(0.95):
                flags.append(f"Active across {int(row['station_count'])} stations")
            if not flags:
                flags.append("Multi-dimensional outlier detected by Isolation Forest")

            results.append({
                'id': str(row['entity_id']),
                'type': entity_type,
                'anomalyScore': float(row['anomaly_score']),
                'isAnomaly': bool(row['is_anomaly']),
                'totalViolations': int(row['total_violations']),
                'activeDays': int(row['active_days']),
                'violationsPerDay': round(float(row['violations_per_day']), 1),
                'rejectionRate': round(float(row['rejection_rate']) * 100, 1),
                'geoSpread': round(float(row['geo_spread']), 4),
                'stationCount': int(row['station_count']),
                'flags': flags,
            })

    results.sort(key=lambda x: -x['anomalyScore'])

    output = {
        'model': 'Isolation Forest',
        'contamination': 0.1,
        'total_entities_analyzed': len(results),
        'anomalies_detected': sum(1 for r in results if r['isAnomaly']),
        'results': results[:50],
    }

    with open(OUT_DIR / "anomaly_predictions.json", 'w') as f:
        json.dump(output, f)

    print(f"[Anomaly] Saved {len(results)} flagged entities")
    return output


if __name__ == "__main__":
    train()
