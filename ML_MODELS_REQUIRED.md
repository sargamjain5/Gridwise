# ML Models & External Data Requirements

This document covers features that require trained ML models or external data to fully implement. Some features use heuristic/proxy implementations, while others are now powered by trained machine learning models.

---

## 1. Congestion Impact Score — PROXY IMPLEMENTED

**Dashboard status:** A proxy score (0–100) is computed per junction using:

```text
score = parking_violations × (1 + multi_violation_ratio) × (1 + rush_hour_share × 0.5)
```

Normalized to the highest-scoring junction.

**Limitations of the proxy:** It measures *enforcement activity patterns*, not actual traffic degradation. A junction may have high violations but low congestion impact if it's on a wide road, or vice versa.

**Full ML implementation would require:**

- **Data needed:** Real-time or historical traffic speed/volume data (Google Maps Traffic API, Bangalore TMC feeds, or INRIX data) joined with violation lat/lon.
- **Model:** Regression (XGBoost/LightGBM) predicting traffic speed reduction as a function of parking violation density, road type, time of day, junction proximity.
- **Benefit over proxy:** Would quantify actual speed/delay impact in km/h or minutes, not just relative violation intensity.

---

## 2. Police Deployment Recommendations — HYBRID IMPLEMENTATION

**Dashboard status:** The dashboard currently uses two layers:

### Heuristic layer

Deployment priority is computed by ranking all station × day × hour combinations by historical violation count.

- Top 5% → Critical
- Next 10% → High

Station profiles show average daily violations and peak enforcement windows.

### ML layer

A forecasting model (`train_forecast.py`) predicts future violation demand.

**Model:** Exponential Smoothing + Day-of-Week Seasonality

**Outputs:**

- 14-day station forecasts
- Peak enforcement windows
- Demand trends

**Limitations:**

Current implementation still does not optimize:

- Officer availability
- Shift constraints
- Travel time
- Budget constraints
- Diminishing returns of enforcement

**Full optimization would require:**

- **Model:** Mixed Integer Linear Programming (MILP) or Constraint Satisfaction using Google OR-Tools.
- **Additional inputs:** Number of available officers per shift, shift duration constraints, travel time matrix between stations, budget constraints.
- **Benefit:** Would produce an actual shift roster that maximizes coverage under real-world constraints.

---

## 3. Anomaly Detection — MACHINE LEARNING IMPLEMENTED

**Dashboard status:** A trained Isolation Forest model detects unusual officer and device behavior.

**Current features:**

- Violations per day
- Rejection rate
- Geographic spread
- Active hour variability
- Station diversity
- Peak-day concentration

**Entities analyzed:**

- 1,361 officers
- 1,436 devices

**Model:**

Isolation Forest

**Assumption:**

10% contamination (expected anomaly rate).

**Limitations:**

- Unsupervised model
- No ground-truth anomaly labels
- Does not imply misconduct
- Requires human verification

**Future improvements:**

Additional features:

- Time between consecutive violations
- Spatial clustering consistency
- Peer comparison within police stations

Potential models:

- Local Outlier Factor
- Autoencoders

---

## 4. Violation Forecasting — IMPLEMENTED

**What it measures:** Predicts future violation counts per station for 14 days ahead.

**Current implementation:**

Model:

Exponential Smoothing + Day-of-Week Seasonality

Features:

- Historical daily counts
- Day of week
- Month

Outputs:

- 14-day forecasts
- Station demand trends
- Peak enforcement windows

**Current limitations:**

Forecasting accuracy is limited because the dataset does not contain:

- Weather information
- Event calendars
- Metro connectivity
- Seasonal events

**Future upgrades:**

Potential models:

- Prophet
- SARIMA

Additional features:

- Event calendars
- Weather data
- Metro station proximity

---

## 5. One-Way Road Suggestions — NOT IMPLEMENTABLE

**What it measures:** Identifies roads where converting to one-way traffic could reduce parking-induced congestion.

**Why it can't be done:** The dataset has **zero information** about road geometry, lane count, directionality, or traffic flow.

One-way recommendations require road network topology.

**Would require:**

- OpenStreetMap road network for Bangalore (`osmnx`)
- Lane count
- Road width
- Existing one-way designations
- Traffic microsimulation (SUMO)

---

## Model Evaluation Summary

Training command:

```bash
cd models

python train_all.py
```

Training time:

```text
≈ 48 seconds
```

| Model | Primary Metric | Value |
|-------|---------------|-------|
| Hotspot Prediction | MAE | 2.504 |
| Hotspot Prediction | R² | 0.152 |
| Repeat Offender Prediction | AUC | 0.730 |
| Validation Engine | AUC | 0.686 |
| Anomaly Detection | Anomalies | 280 |
| Violation Forecasting | Stations Forecasted | 12 |

---

## Summary

| Feature | Status | Data Available? | External Data? | Complexity |
|---|---|---|---|---|
| Congestion Impact | Proxy Implemented | Partial | Yes | Medium |
| Police Deployment | Hybrid (Heuristic + ML) | Yes | Optional | Medium |
| Anomaly Detection | ML Implemented | Yes | No | Medium |
| Violation Forecasting | Implemented | Yes | Optional | Medium |
| One-Way Road Suggestions | Not Implementable | No | OSM Required | High |
