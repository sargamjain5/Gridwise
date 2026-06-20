# Parking Intelligence Dashboard

A dual-purpose web dashboard for **Bangalore Police** (enforcement) and **citizens** (smart parking + violation reporting), built with React, TypeScript, Vite, shadcn/ui, Recharts, and Leaflet.

## Quick Start

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5173
```

Data is pre-loaded from `public/precomputed.json` (computed from 2.98 lakh violation records). To use trained ML model predictions:

```bash
cd ../model
python train_all.py  # Trains 5 models, exports to dashboard/public/ml_models.json (~50s)
```

For real ANPR (vehicle + plate detection) in the CCTV and Mobility Rewards panels:

```bash
cd ../model
python server.py     # Starts FastAPI on http://localhost:8000
```

## Architecture

```
dashboard/
├── public/
│   ├── precomputed.json      # Pre-aggregated metrics from CSV (0.9 MB)
│   └── ml_models.json        # Trained model predictions (0.3 MB)
├── scripts/
│   └── precompute.mjs        # Node script: CSV → precomputed.json
├── src/
│   ├── lib/                  # Data processing, prediction engines, types
│   └── components/
│       ├── *Panel.tsx         # Police dashboard pages
│       └── public/            # Public dashboard components
```

## Police Dashboard (9 pages)

| Page | Purpose | ML Model |
|---|---|---|
| **Overview** | KPI cards, active alerts, quick-nav | — |
| **Hotspot Prediction** | Predict violations for any location/time on interactive map | XGBoost Regressor |
| **CCTV Automation** | No-parking zone polygons, vehicle detection, violation flagging, real ANPR upload | YOLOv8 + EasyOCR + Validation model |
| **Deployment Engine** | Time-aware officer deployment with special events and seasonal adjustments | Exponential Smoothing forecast |
| **Offender Risk Engine** | Risk score (0-100) for repeat offenders with re-offense probability | XGBoost Classifier |
| **Policy Recommendations** | Infrastructure suggestions (parking bays, pickup lanes, one-way, timed parking) | Rule-based geographic analysis |
| **Hotspots & Congestion** | Station + junction violation rankings | — |
| **Anomaly Detection** | Officer/device outlier flagging | Isolation Forest |
| **Spatial Map** | Full-width Leaflet map with violation density circles | — |

## Public Dashboard (3 tabs)

| Tab | Purpose |
|---|---|
| **Parking Map & Alerts** | Live map with no-parking zones, occupancy bars, availability counts |
| **Smart Recommendations** | Search destination → ranked parking spots by walking distance, congestion, enforcement risk |
| **Mobility Rewards (YOLO+OCR)** | Upload violation photo → real ANPR detects vehicle + reads plate → rewards points for confirmed reports |

## Data Flow

```
CSV (104 MB, 298K records)
  │
  ├─→ precompute.mjs ─→ precomputed.json (0.9 MB)  ← dashboard loads on startup
  │
  └─→ train_all.py ─→ ml_models.json (0.3 MB)      ← dashboard loads on startup
                    ─→ model/trained/*.joblib         ← saved model weights

User uploads new CSV ─→ processData.ts ─→ all panels recompute live (in-browser)

ANPR API (localhost:8000)
  ├─→ POST /detect/image  ← CCTV Automation + Mobility Rewards call this
  └─→ POST /detect/video  ← video processing with parked vehicle detection
```

## Regenerating Data

If the source CSV changes:

```bash
# Regenerate precomputed metrics
cd dashboard && node scripts/precompute.mjs

# Retrain all models
cd ../model && python train_all.py
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui
- **Charts**: Recharts (bar, line, area, radar, pie, scatter, composed)
- **Maps**: Leaflet + react-leaflet (OpenStreetMap tiles)
- **Backend**: FastAPI + uvicorn (ANPR API)
- **ML**: XGBoost, scikit-learn (Isolation Forest), EasyOCR, YOLOv8 (ultralytics)
