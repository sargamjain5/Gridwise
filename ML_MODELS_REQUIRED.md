# ML Models & External Data Requirements

This document covers features that require trained ML models or external data to fully implement. **Three of these now have heuristic/proxy implementations** in the dashboard (marked below), while two still require external data.

---

## 1. Congestion Impact Score — PROXY IMPLEMENTED

**Dashboard status:** A proxy score (0–100) is computed per junction using:
```
score = parking_violations × (1 + multi_violation_ratio) × (1 + rush_hour_share × 0.5)
```
Normalized to the highest-scoring junction.

**Limitations of the proxy:** It measures *enforcement activity patterns*, not actual traffic degradation. A junction may have high violations but low congestion impact if it's on a wide road, or vice versa.

**Full ML implementation would require:**
- **Data needed:** Real-time or historical traffic speed/volume data (Google Maps Traffic API, Bangalore TMC feeds, or INRIX data) joined with violation lat/lon.
- **Model:** Regression (XGBoost/LightGBM) predicting traffic speed reduction as a function of parking violation density, road type, time of day, junction proximity.
- **Benefit over proxy:** Would quantify actual speed/delay impact in km/h or minutes, not just relative violation intensity.

---

## 2. Police Deployment Recommendations — HEURISTIC IMPLEMENTED

**Dashboard status:** Deployment priority is computed by ranking all station × day × hour combinations by historical violation count. Top 5% = critical, next 10% = high. Station profiles show average daily violations and peak enforcement windows.

**Limitations:** Assumes past patterns predict future violations. Does not account for officer availability, shift constraints, travel time, or diminishing returns of enforcement.

**Full optimization would require:**
- **Model:** Mixed Integer Linear Programming (MILP) or Constraint Satisfaction using Google OR-Tools.
- **Additional inputs:** Number of available officers per shift, shift duration constraints, travel time matrix between stations, budget constraints.
- **Benefit:** Would produce an actual shift roster that maximizes coverage under real-world constraints.

---

## 3. Anomaly Detection — IMPLEMENTED (Statistical)

**Dashboard status:** Z-score analysis across three dimensions per officer/device:
- Activity rate (violations/day)
- Rejection rate (% of validated records rejected)
- Geographic spread (std dev of lat/lon)

Composite score = 0.4 × |z_activity| + 0.35 × |z_rejection| + 0.25 × |z_geo|. Entities with z > 2 in any dimension are flagged.

**Limitations:** Z-scores assume roughly normal distributions. Cannot detect sophisticated patterns like collusion or temporal manipulation.

**Full ML implementation would use:**
- **Model:** Isolation Forest or Local Outlier Factor for multi-dimensional anomaly detection.
- **Additional features:** Time between consecutive violations by same device, spatial clustering consistency, comparison with peer officers at the same station.
- **Benefit:** Would catch subtler anomalies and reduce false positives.

---

## 4. Violation Forecasting — NOT IMPLEMENTED

**What it measures:** Predicts future violation counts by zone and time window.

**Why it's not in the dashboard:** Proper time-series forecasting requires models like Prophet or SARIMA, which are Python-based. A JavaScript moving-average extrapolation would be too simplistic to be useful.

**Recommended implementation:**
- **Model:** Prophet (Facebook) or SARIMA for station-level weekly forecasting.
- **Features from this dataset:** Historical daily/weekly counts per station, day of week, month, hour patterns.
- **Additional features that would help:** Event calendars, weather data, metro station proximity.

---

## 5. One-Way Road Suggestions — NOT IMPLEMENTABLE

**What it measures:** Identifies roads where converting to one-way traffic could reduce parking-induced congestion.

**Why it can't be done:** The dataset has **zero information** about road geometry, lane count, directionality, or traffic flow. One-way recommendations require road network topology.

**Would require:**
- OpenStreetMap road network for Bangalore (via `osmnx`)
- Lane count, road width, existing one-way designations
- Traffic microsimulation (SUMO) to evaluate one-way conversion impact

---

## Summary

| Feature | Status | Data Available? | External Data? | Complexity |
|---|---|---|---|---|
| Anomaly Detection | Implemented (z-score) | Yes | No | Low |
| Police Deployment | Implemented (heuristic) | Yes | No | Low |
| Congestion Impact | Implemented (proxy) | Partial | No | Low |
| Violation Forecasting | Not implemented | Yes | Optional | Medium |
| One-Way Road Suggestions | Not implementable | No | OSM needed | High |
