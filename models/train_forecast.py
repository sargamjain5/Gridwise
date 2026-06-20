"""
Violation Forecasting (per-station daily time series)
Uses simple exponential smoothing + day-of-week seasonality.
(Prophet would be better but adds heavy dependency — this is lightweight)
"""
import pandas as pd
import numpy as np
import json
from pathlib import Path

# ---------- PATHS ----------

BASE_DIR = Path(__file__).resolve().parent

CSV_PATH = BASE_DIR / "jan to may police violation_anonymized791b166.csv"

OUT_DIR = BASE_DIR / "trained"

OUT_DIR.mkdir(parents=True, exist_ok=True)

print("CSV:", CSV_PATH)
print("Exists:", CSV_PATH.exists())


def train():
    print("[Forecast] Loading data...")
    df = pd.read_csv(CSV_PATH, low_memory=False,
                     usecols=['created_datetime', 'police_station'])

    df['created_datetime'] = pd.to_datetime(df['created_datetime'], errors='coerce', utc=True)
    df = df.dropna(subset=['created_datetime'])
    df['ist'] = df['created_datetime'] + pd.Timedelta(hours=5, minutes=30)
    df['date'] = df['ist'].dt.date

    # Top 12 stations
    top_stations = df['police_station'].value_counts().head(12).index.tolist()

    results = {}

    for station in top_stations:
        sdf = df[df['police_station'] == station]
        daily = sdf.groupby('date').size().reset_index(name='count')
        daily['date'] = pd.to_datetime(daily['date'])
        daily = daily.sort_values('date')

        # Fill missing dates with 0
        full_range = pd.date_range(daily['date'].min(), daily['date'].max())
        daily = daily.set_index('date').reindex(full_range, fill_value=0).reset_index()
        daily.columns = ['date', 'count']

        daily['dow'] = daily['date'].dt.dayofweek
        daily['week'] = daily['date'].dt.isocalendar().week.astype(int)

        # Train/test split: last 14 days for testing
        split_date = daily['date'].max() - pd.Timedelta(days=14)
        train = daily[daily['date'] <= split_date]
        test = daily[daily['date'] > split_date]

        if len(train) < 30:
            continue

        # Day-of-week seasonality: average per day-of-week
        dow_avg = train.groupby('dow')['count'].mean()
        overall_avg = train['count'].mean()
        dow_factors = (dow_avg / overall_avg).to_dict()

        # Exponential smoothing for trend
        alpha = 0.3
        smoothed = [train['count'].iloc[0]]
        for i in range(1, len(train)):
            smoothed.append(alpha * train['count'].iloc[i] + (1 - alpha) * smoothed[-1])
        trend = smoothed[-1]

        # Forecast next 14 days
        forecasts = []
        for i in range(14):
            fdate = split_date + pd.Timedelta(days=i + 1)
            dow = fdate.dayofweek
            predicted = trend * dow_factors.get(dow, 1.0)
            forecasts.append({
                'date': fdate.strftime('%Y-%m-%d'),
                'predicted': round(max(0, predicted), 1),
                'dow': int(dow),
            })

        # Evaluate on test set
        if len(test) > 0:
            test_predictions = []
            for _, row in test.iterrows():
                pred = trend * dow_factors.get(row['dow'], 1.0)
                test_predictions.append(max(0, pred))

            actuals = test['count'].values
            preds_arr = np.array(test_predictions[:len(actuals)])
            mae = np.mean(np.abs(actuals - preds_arr))
            mape = np.mean(np.abs((actuals - preds_arr) / np.maximum(actuals, 1))) * 100
        else:
            mae = 0
            mape = 0

        # Historical daily data for chart (last 60 days)
        recent = daily.tail(60)
        history = [{'date': r['date'].strftime('%Y-%m-%d'), 'count': int(r['count'])}
                   for _, r in recent.iterrows()]

        results[station] = {
            'trend': round(trend, 1),
            'dowFactors': {str(k): round(v, 3) for k, v in dow_factors.items()},
            'mae': round(mae, 1),
            'mape': round(mape, 1),
            'forecasts': forecasts,
            'history': history,
        }

        print(f"[Forecast] {station}: trend={trend:.1f}/day, MAE={mae:.1f}, MAPE={mape:.1f}%")

    output = {
        'model': 'Exponential Smoothing + Day-of-Week Seasonality',
        'stations': len(results),
        'forecast_horizon_days': 14,
        'results': results,
    }

    with open(OUT_DIR / "forecast_predictions.json", 'w') as f:
        json.dump(output, f)

    print(f"[Forecast] Saved forecasts for {len(results)} stations")
    return output


if __name__ == "__main__":
    train()
