"""
Hotspot Prediction Model (XGBoost)
Features: lat, lon, hour, day_of_week, month, station_encoded
Target: violation count per grid cell per hour bucket
"""
import pandas as pd
import numpy as np
import json
import joblib
from pathlib import Path
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error, r2_score

# ---------- PATHS ----------

BASE_DIR = Path(__file__).resolve().parent

CSV_PATH = BASE_DIR / "jan to may police violation_anonymized791b166.csv"

OUT_DIR = BASE_DIR / "trained"

OUT_DIR.mkdir(parents=True, exist_ok=True)

print("CSV:", CSV_PATH)
print("Exists:", CSV_PATH.exists())


def train():
    print("[Hotspot] Loading data...")
    df = pd.read_csv(CSV_PATH, low_memory=False,
                     usecols=['latitude', 'longitude', 'created_datetime', 'police_station', 'junction_name', 'violation_type'])

    df['created_datetime'] = pd.to_datetime(df['created_datetime'], errors='coerce', utc=True)
    df = df.dropna(subset=['created_datetime', 'latitude', 'longitude'])
    df['ist'] = df['created_datetime'] + pd.Timedelta(hours=5, minutes=30)
    df['hour'] = df['ist'].dt.hour
    df['day_of_week'] = df['ist'].dt.dayofweek  # 0=Mon
    df['month'] = df['ist'].dt.month
    df['date'] = df['ist'].dt.date

    # Grid cells (~500m)
    df['grid_lat'] = (df['latitude'] * 200).round() / 200
    df['grid_lon'] = (df['longitude'] * 200).round() / 200

    # Filter to Bangalore bounds
    mask = (df['grid_lat'].between(12.8, 13.15)) & (df['grid_lon'].between(77.45, 77.78))
    df = df[mask]

    print(f"[Hotspot] {len(df):,} records after filtering")

    # Encode station
    le_station = LabelEncoder()
    df['station_enc'] = le_station.fit_transform(df['police_station'].fillna('Unknown'))

    # Aggregate: count violations per (grid_lat, grid_lon, hour, day_of_week, date)
    agg = df.groupby(['grid_lat', 'grid_lon', 'hour', 'day_of_week', 'month', 'station_enc', 'date']).size().reset_index(name='count')

    # Average across dates to get expected violations per cell per hour-slot
    features_df = agg.groupby(['grid_lat', 'grid_lon', 'hour', 'day_of_week', 'month', 'station_enc']).agg(
        avg_count=('count', 'mean'),
        max_count=('count', 'max'),
        total_count=('count', 'sum'),
        num_days=('date', 'nunique'),
    ).reset_index()

    features_df['target'] = features_df['avg_count']

    print(f"[Hotspot] {len(features_df):,} training samples")

    # Features
    feature_cols = ['grid_lat', 'grid_lon', 'hour', 'day_of_week', 'month', 'station_enc']
    X = features_df[feature_cols]
    y = features_df['target']

    # Time-based split: train on months 11,12,1,2 — test on 3,4
    train_mask = features_df['month'].isin([11, 12, 1, 2])
    test_mask = features_df['month'].isin([3, 4])

    X_train, X_test = X[train_mask], X[test_mask]
    y_train, y_test = y[train_mask], y[test_mask]

    print(f"[Hotspot] Train: {len(X_train):,}, Test: {len(X_test):,}")

    # Train XGBoost
    model = XGBRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    # Evaluate
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    print(f"[Hotspot] MAE: {mae:.3f}, R²: {r2:.3f}")

    # Save model
    joblib.dump(model, OUT_DIR / "hotspot_xgb.joblib")
    joblib.dump(le_station, OUT_DIR / "hotspot_station_encoder.joblib")

    # Generate prediction grid for dashboard (all cells × current conditions)
    # For each unique grid cell, predict across all hours and days
    unique_cells = features_df[['grid_lat', 'grid_lon', 'station_enc']].drop_duplicates()
    predictions = []

    for _, cell in unique_cells.iterrows():
        for hour in range(24):
            for dow in range(7):
                # Use month=3 as default (recent)
                row = {
                    'grid_lat': cell['grid_lat'],
                    'grid_lon': cell['grid_lon'],
                    'hour': hour,
                    'day_of_week': dow,
                    'month': 3,
                    'station_enc': cell['station_enc'],
                }
                predictions.append(row)

    pred_df = pd.DataFrame(predictions)
    pred_df['predicted'] = model.predict(pred_df[feature_cols])
    pred_df['predicted'] = pred_df['predicted'].clip(lower=0)

    # Aggregate to manageable size: for each cell, store hourly and daily arrays
    cell_preds = {}
    for _, row in pred_df.iterrows():
        key = f"{row['grid_lat']},{row['grid_lon']}"
        if key not in cell_preds:
            cell_preds[key] = {
                'lat': row['grid_lat'], 'lon': row['grid_lon'],
                'hourly': [0.0] * 24, 'daily': [0.0] * 7,
                'total': 0.0,
            }
        cell_preds[key]['hourly'][int(row['hour'])] += row['predicted'] / 7  # avg across days
        cell_preds[key]['daily'][int(row['day_of_week'])] += row['predicted'] / 24  # avg across hours
        cell_preds[key]['total'] += row['predicted']

    # Export top cells
    sorted_cells = sorted(cell_preds.values(), key=lambda x: -x['total'])[:200]
    for c in sorted_cells:
        c['hourly'] = [round(v, 2) for v in c['hourly']]
        c['daily'] = [round(v, 2) for v in c['daily']]
        c['total'] = round(c['total'], 1)

    output = {
        'model': 'XGBoost',
        'mae': round(mae, 3),
        'r2': round(r2, 3),
        'train_size': len(X_train),
        'test_size': len(X_test),
        'feature_importance': dict(zip(feature_cols, [round(float(x), 4) for x in model.feature_importances_])),
        'predictions': sorted_cells,
    }

    with open(OUT_DIR / "hotspot_predictions.json", 'w') as f:
        json.dump(output, f)

    print(f"[Hotspot] Saved model + {len(sorted_cells)} cell predictions")
    return output


if __name__ == "__main__":
    train()
