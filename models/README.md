# ML Models for Parking Intelligence

5 trained models + 1 real-time ANPR pipeline for the Parking Intelligence Dashboard.

## Quick Start

```bash
cd model

# Train all models (~50 seconds)
python train_all.py

# Start ANPR API server
python server.py     # http://localhost:8000 — Swagger docs at /docs
```

## Models

### 1. Hotspot Prediction — `train_hotspot.py`

Predicts violation count per ~500m grid cell per hour.

| Detail | Value |
|---|---|
| Algorithm | XGBoost Regressor |
| Features | `grid_lat`, `grid_lon`, `hour`, `day_of_week`, `month`, `station_enc` |
| Target | Average violations per cell per hour-slot |
| Train/Test Split | Time-based: Nov-Feb (train) → Mar-Apr (test) |
| MAE | 2.511 |
| R² | 0.148 |
| Output | 200 cell predictions with hourly[24] + daily[7] arrays |

**Feature importance**: `grid_lon` (29%) > `grid_lat` (25%) > `hour` (19%) > `station_enc` (14%) > `day_of_week` (8%) > `month` (5%)

### 2. Offender Re-offense Prediction — `train_offender.py`

Predicts whether a vehicle with prior violations will re-offend within 30 days.

| Detail | Value |
|---|---|
| Algorithm | XGBoost Classifier |
| Features | 17 features: violation count, frequency/month, station spread, vehicle type, parking ratio, temporal patterns, geographic spread, escalation rate, recency, rejection rate |
| Target | Binary: re-offended within 30 days (13.3% positive rate) |
| Train/Test Split | 80/20 stratified random |
| AUC | 0.727 |
| Precision/Recall | 0.27 / 0.55 (tuned for recall — catch more re-offenders) |
| Output | 500 vehicle risk scores (0-100) with re-offense probability |

**Feature importance**: `recency_days` (22%) > `total_violations` (14%) > `freq_per_month` (12%) > `lat_std` (10%) > `lon_std` (9%)

### 3. Anomaly Detection — `train_anomaly.py`

Flags officers and devices with unusual enforcement patterns.

| Detail | Value |
|---|---|
| Algorithm | Isolation Forest |
| Features | `violations_per_day`, `rejection_rate`, `geo_spread`, `hour_std`, `station_count`, `peak_day_ratio` |
| Entities | 1,361 officers + 1,436 devices (with 20+ violations) |
| Contamination | 10% (expected anomaly rate) |
| Output | 50 flagged entities with anomaly scores + human-readable flags |

**Example flag**: "Unusually high activity: 68.0/day, High rejection rate: 100.0%, Concentrated activity: 100% on single day"

### 4. Validation Outcome Prediction — `train_validation.py`

Predicts whether a violation record will be approved or rejected (auto-triage).

| Detail | Value |
|---|---|
| Algorithm | XGBoost Classifier |
| Features | `vehicle_type`, `station`, `junction`, `hour`, `day_of_week`, `is_parking`, `multi_violation`, `device_volume` |
| Target | Binary: approved vs rejected (69.9% approval rate) |
| Train/Test Split | 80/20 stratified random |
| AUC | 0.688 |
| Output | Per-station and per-vehicle-type approval probability predictions |

**Usage**: Shown as auto-triage label in CCTV Automation panel ("CAR: Approval 75%").

### 5. Violation Forecasting — `train_forecast.py`

Predicts daily violation counts per station for 14 days ahead.

| Detail | Value |
|---|---|
| Algorithm | Exponential Smoothing (α=0.3) + Day-of-Week Seasonality |
| Stations | 12 (top by volume) |
| History | 60 days of daily counts |
| Horizon | 14-day forecast |
| Output | Per-station: trend, day-of-week factors, forecasts, history |

**Usage**: Blended into Deployment Engine (60% ML forecast + 40% historical average).

### 6. ANPR Pipeline — `anpr.py` + `server.py`

Real-time vehicle detection + license plate reading.

| Detail | Value |
|---|---|
| Vehicle Detection | YOLOv8n (COCO pretrained, 6MB) |
| Plate OCR | EasyOCR (English model, ~100MB) |
| Plate Cleaning | Regex for Indian plate formats (KA01AB1234), O→0/I→1 substitution |
| Video Mode | Frame sampling at configurable FPS, IoU-based parked vehicle detection |
| Violation Check | Point-in-polygon (Shapely) or edge heuristic |

**API Endpoints**:
```
GET  /health              # Status check
POST /detect/image        # Upload image → vehicle + plate detection
POST /detect/video        # Upload video → frame-by-frame detection
```

## Saved Artifacts

```
model/trained/
├── hotspot_xgb.joblib              # 932 KB
├── hotspot_station_encoder.joblib
├── hotspot_predictions.json        # 200 cell predictions
├── offender_xgb.joblib             # 494 KB
├── offender_predictions.json       # 500 vehicle risk scores
├── anomaly_officer_iforest.joblib  # 2 MB
├── anomaly_device_iforest.joblib   # 2 MB
├── anomaly_*_scaler.joblib
├── anomaly_predictions.json        # 50 flagged entities
├── validation_xgb.joblib           # 539 KB
├── validation_predictions.json     # Per-station approval rates
├── forecast_predictions.json       # 12 stations × 14-day forecasts
└── yolov8n.pt                      # 6 MB (downloaded on first run)
```

## Dataset Requirements

All models are trained on `jan to may police violation_anonymized791b166.csv` with these columns:

| Column | Used by |
|---|---|
| `latitude`, `longitude` | Hotspot, Offender (geo spread) |
| `created_datetime` | All models (temporal features) |
| `police_station` | Hotspot, Forecast, Offender, Validation |
| `junction_name` | Offender, Validation |
| `vehicle_number` | Offender |
| `vehicle_type` | Offender, Validation |
| `violation_type` | Offender, Validation |
| `validation_status` | Offender, Anomaly, Validation |
| `device_id`, `created_by_id` | Anomaly |

## Limitations

| Model | Limitation |
|---|---|
| Hotspot | R²=0.148 — violation patterns have high variance. More months of data would help. |
| Offender | Low precision (0.27) — high recall means it catches re-offenders but also flags non-re-offenders. Need more data for better precision. |
| Anomaly | Unsupervised — no ground truth. 10% contamination is assumed, not validated. |
| Validation | AUC=0.688 — moderate. Approval decisions may depend on factors not in the data (photo quality, officer notes). |
| Forecast | Simple exponential smoothing. Prophet or SARIMA would capture trends better but add heavy dependencies. |
| ANPR | Generic YOLOv8n not fine-tuned on Indian vehicles. EasyOCR struggles with non-standard Indian plate formats, angled/dirty plates. Fine-tuning on Indian plate dataset would significantly improve accuracy. |
