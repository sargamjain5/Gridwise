# GridWise

**GridWise** is an AI-powered urban mobility and parking intelligence platform built for **Bangalore Police** (enforcement) and **citizens** (smart parking, congestion reduction, and violation reporting).

It combines **predictive analytics, computer vision, and geospatial intelligence** to optimize parking utilization, improve traffic flow, and automate violation detection.

Built with **React, TypeScript, Vite, FastAPI, XGBoost, YOLOv8, EasyOCR, and Leaflet**.

---

## Quick Start

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Start the frontend

```bash
npm run dev
```

The dashboard will be available at:

```
http://localhost:5173
```

---

### 3. Generate ML predictions (Optional)

This trains all models and exports predictions to `public/ml_models.json`.

```bash
cd models

python train_all.py
```

Training takes approximately **40–60 seconds**.

---

### 4. Start the ANPR backend (Optional)

This enables real-time vehicle and license plate detection.

```bash
cd models

python server.py
```

Backend:

```
http://localhost:8000
```

Swagger documentation:

```
http://localhost:8000/docs
```

Health check:

```
http://localhost:8000/health
```

---

## Architecture

```text
GridWise/
├── models/
│   ├── trained/
│   ├── server.py
│   ├── train_all.py
│   ├── train_hotspot.py
│   ├── train_offender.py
│   ├── train_anomaly.py
│   ├── train_validation.py
│   ├── train_forecast.py
│   └── jan to may police violation_anonymized791b166.csv
│
├── public/
│   ├── precomputed.json
│   └── ml_models.json
│
├── scripts/
│   └── precompute.mjs
│
└── src/
    ├── components/
    └── lib/
```

---

## Police Dashboard (9 Pages)

| Page | Purpose | ML Model |
|------|---------|----------|
| **Overview** | KPI cards, alerts, quick navigation | — |
| **Hotspot Prediction** | Predict violations for any location and time | XGBoost Regressor |
| **CCTV Automation** | No-parking detection, ANPR and violation flagging | YOLOv8 + EasyOCR |
| **Deployment Engine** | Predictive officer deployment | Exponential Smoothing |
| **Offender Risk Engine** | Risk score for repeat offenders | XGBoost Classifier |
| **Policy Recommendations** | Infrastructure planning suggestions | Rule-based Engine |
| **Hotspots & Congestion** | Station and junction rankings | — |
| **Anomaly Detection** | Officer and device outlier detection | Isolation Forest |
| **Spatial Map** | City-wide violation density visualization | — |

---

## Public Dashboard (3 Tabs)

| Tab | Purpose |
|-----|---------|
| **Parking Map & Alerts** | Parking availability and no-parking zones |
| **Smart Recommendations** | Suggest optimal parking locations |
| **Mobility Rewards** | Upload violation images and earn reward points |

---

## Data Flow

```text
CSV Dataset (298K records)

     │

     ├── precompute.mjs
     │
     └── public/precomputed.json

     │

     └── train_all.py
           │
           ├── public/ml_models.json
           └── models/trained/*.joblib


User uploads CSV

     │

     └── processData.ts

            │

            └── Dashboard updates live


ANPR Backend (localhost:8000)

     │

     ├── POST /detect/image

     └── POST /detect/video
```

---

## Regenerating Data

If the source CSV changes:

### Regenerate precomputed metrics

```bash
node scripts/precompute.mjs
```

### Retrain all ML models

```bash
cd models

python train_all.py
```

---

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- shadcn/ui

### Visualization

- Recharts
- Leaflet
- OpenStreetMap

### Backend

- FastAPI
- Uvicorn

### Machine Learning

- XGBoost
- Scikit-learn
- Isolation Forest
- YOLOv8
- EasyOCR

### Computer Vision

- Ultralytics
- OpenCV
- Supervision

### Data Processing

- Pandas
- NumPy

---

## Dataset Setup

Place the file below manually inside the `models/` folder before training:

```text
models/jan to may police violation_anonymized791b166.csv
```

Then run:

```bash
cd models

python train_all.py
```
