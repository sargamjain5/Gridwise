# ML Models, Assumptions & Evaluation

This document summarizes all predictive models used in GridWise, their assumptions, limitations, evaluation metrics, and future improvements.

GridWise uses a hybrid architecture consisting of:

1. Heuristic and statistical computations (`precompute.mjs`)
2. Machine learning models (`train_*.py`)

---

# 1. Congestion Impact Score — PROXY IMPLEMENTED

## Current Implementation

Congestion score is computed as:

```text
score =
parking_violations
× (1 + multi_violation_ratio)
× (1 + rush_hour_share × 0.5)
```

Normalized to a 0–100 scale.

## Inputs

- Parking violations
- Multi-violation ratio
- Rush hour concentration

## Limitation

This measures enforcement intensity rather than actual traffic degradation.

## Future Work

Additional data:

- Google Maps Traffic API
- Bangalore TMC feeds
- INRIX data

Models:

- XGBoost
- LightGBM

Target:

- Speed reduction
- Delay estimation

---

# 2. Police Deployment Engine — HYBRID IMPLEMENTATION

## Heuristic Layer

Historical ranking using:

- Station
- Day of week
- Hour

Priority:

- Top 5% → Critical
- Next 10% → High

## ML Layer

Model:

Exponential Smoothing + Day-of-Week Seasonality

Outputs:

- 14-day forecasts
- Peak windows
- Demand trends

## Limitation

Does not optimize:

- Officer availability
- Shift constraints
- Travel time
- Budget

## Future Work

Use:

- Google OR-Tools
- MILP optimization

---

# 3. Anomaly Detection — HYBRID IMPLEMENTATION

## Statistical Layer

Z-score analysis:

```text
0.40 × activity_z
+ 0.35 × rejection_z
+ 0.25 × geo_z
```

## ML Layer

Model:

Isolation Forest

Features:

- Violations per day
- Rejection rate
- Geographic spread
- Active hour variability
- Station diversity
- Peak-day concentration

## Limitation

Does not imply misconduct.

Human review is required.

---

# 4. Violation Forecasting — IMPLEMENTED

Model:

Exponential Smoothing + Day-of-Week Seasonality

Inputs:

- Historical counts
- Day of week
- Month

Outputs:

- 14-day forecasts
- MAE
- MAPE

Future improvements:

- Weather
- Event calendars
- Metro connectivity

Potential upgrades:

- Prophet
- SARIMA

---

# 5. Hotspot Prediction — IMPLEMENTED

Model:

XGBoost Regressor

Features:

- Latitude
- Longitude
- Hour
- Day of week
- Month
- Police station

Outputs:

- Hourly hotspot maps
- Daily hotspot maps
- Top 200 hotspot cells

Future improvements:

- Weather
- Events
- Road type
- Public transport

---

# 6. Repeat Offender Prediction — IMPLEMENTED

Model:

XGBoost Classifier

Goal:

Predict whether a vehicle will commit another violation within 30 days.

Features:

- Violation frequency
- Station diversity
- Parking ratio
- Temporal patterns
- Geographic spread
- Escalation score
- Recency
- Validation rejection rate

Outputs:

- Risk score
- Reoffense probability
- Risk category

---

# 7. One-Way Road Suggestions — NOT IMPLEMENTABLE

The dataset does not contain:

- Road geometry
- Lane count
- Road directionality
- Traffic flow

Would require:

- OpenStreetMap
- OSMnx
- SUMO traffic simulation

---

# Model Evaluation

Training command:

```bash
cd models

python train_all.py
```

Training time:

```text
≈ 48 seconds
```

---

## Hotspot Prediction

| Metric | Value |
|--------|-------|
| MAE | 2.504 |
| R² | 0.152 |
| Training Samples | 43,622 |
| Test Samples | 14,779 |

---

## Repeat Offender Prediction

| Metric | Value |
|--------|-------|
| AUC | 0.730 |
| Accuracy | 75% |
| Precision | 27% |
| Recall | 54% |
| F1 Score | 36% |
| Positive Rate | 13.3% |

Dataset:

| Metric | Value |
|--------|-------|
| Vehicles | 24,051 |
| Training Samples | 19,240 |
| Test Samples | 4,811 |

---

## Anomaly Detection

| Metric | Value |
|--------|-------|
| Officers Analysed | 1,361 |
| Devices Analysed | 1,436 |
| Officer Anomalies | 136 |
| Device Anomalies | 144 |
| Flagged Entities | 60 |

---

## Validation Confidence Engine

| Metric | Value |
|--------|-------|
| AUC | 0.686 |
| Accuracy | 72% |
| Approval Rate | 69.9% |

Dataset:

| Metric | Value |
|--------|-------|
| Records | 165,154 |
| Training Samples | 132,123 |
| Test Samples | 33,031 |

---

## Violation Forecasting

12 police stations forecasted.

| Station | MAE | MAPE |
|---------|-----|------|
| Upparpet | 70.0 | 23.5% |
| Shivajinagar | 134.4 | 59.0% |
| Malleshwaram | 68.6 | 38.4% |
| HAL Old Airport | 41.0 | 93.7% |
| City Market | 65.9 | 43.5% |
| Vijayanagara | 23.2 | 64.0% |
| Rajajinagar | 51.1 | 45.2% |
| Kodigehalli | 31.8 | 56.7% |
| Magadi Road | 54.2 | 121.6% |
| Jeevanbheemanagar | 12.4 | 57.8% |
| K.R. Pura | 26.3 | 102.3% |
| Halasuru Gate | 18.6 | 90.5% |

---

# Overall Training Summary

| Model | Algorithm | Primary Metric |
|-------|-----------|---------------|
| Hotspot Prediction | XGBoost Regressor | MAE = 2.504 |
| Repeat Offender Prediction | XGBoost Classifier | AUC = 0.730 |
| Anomaly Detection | Isolation Forest | 280 anomalies |
| Validation Engine | XGBoost Classifier | AUC = 0.686 |
| Violation Forecasting | Exponential Smoothing | 12 stations forecasted |
