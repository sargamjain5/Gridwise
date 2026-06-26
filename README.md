# GridWise

GridWise is an AI-powered urban mobility and parking intelligence platform built for **Bangalore Police** (enforcement) and **citizens** (smart parking, congestion reduction, and violation reporting).

It combines **predictive analytics, computer vision, and geospatial intelligence** to optimize parking utilization, improve traffic flow, and automate violation detection.

Live Demo: https://gridwise-frontend.onrender.com/
Built using **React, TypeScript, Vite, FastAPI, XGBoost, YOLOv8, EasyOCR, Isolation Forest, and Leaflet**.

---

## Features

### Police Dashboard

GridWise provides 9 analytics modules for authorities:

| Module | Description |
|--------|-------------|
| Overview | KPI cards, alerts and quick navigation |
| Hotspot Prediction | Predict future violation hotspots |
| CCTV Automation | Detect violations using ANPR |
| Deployment Engine | Recommend enforcement deployment |
| Offender Risk Engine | Identify repeat offenders |
| Policy Recommendations | Suggest infrastructure interventions |
| Hotspots & Congestion | Rank stations and junctions |
| Anomaly Detection | Detect unusual officer/device behavior |
| Spatial Map | Visualize city-wide violations |

---

### Public Dashboard

GridWise also provides citizen-facing tools:

| Module | Description |
|--------|-------------|
| Parking Map & Alerts | Live parking availability |
| Smart Recommendations | Recommend optimal parking spots |
| Mobility Rewards | Upload violations and earn reward points |

---

## Machine Learning Overview

GridWise uses five machine learning models:

| Model | Algorithm |
|-------|-----------|
| Hotspot Prediction | XGBoost Regressor |
| Repeat Offender Prediction | XGBoost Classifier |
| Validation Confidence Engine | XGBoost Classifier |
| Anomaly Detection | Isolation Forest |
| Violation Forecasting | Exponential Smoothing |

Detailed assumptions, limitations and evaluation metrics are available in:

```text
ML_MODELS_REQUIRED.md
```

---

## Quick Start

### Install dependencies

```bash
npm install
```

### Start frontend

```bash
npm run dev
```
---

## Train Machine Learning Models

```bash
cd models

python train_all.py
```

This generates:

```text
public/ml_models.json
models/trained/*.joblib
```

Training takes approximately:

```text
45-60 seconds
```

---

## Start ANPR Backend 

```bash
cd models

python server.py
```

Backend:

```text
http://localhost:8000
```

Swagger docs:

```text
http://localhost:8000/docs
```

Health check:

```text
http://localhost:8000/health
```

---

## Architecture

```text
GridWise/

├── models/
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

## Data Flow

```text
CSV Dataset (298K Records)

        │
 ┌──────┴──────┐

precompute.mjs  train_*.py

       │             │
       │             ├── Hotspot Prediction
       │             ├── Offender Prediction
       │             ├── Forecasting
       │             ├── Validation Engine
       │             └── Isolation Forest
       │

precomputed.json   ml_models.json
        │
        ▼
 React Dashboard


ANPR Backend

POST /detect/image

POST /detect/video
```

---

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- shadcn/ui

### Backend

- FastAPI
- Uvicorn

### Machine Learning

- XGBoost
- Scikit-learn
- Isolation Forest
- Exponential Smoothing

### Computer Vision

- YOLOv8
- EasyOCR
- OpenCV
- Supervision

### Visualization

- Recharts
- Leaflet
- OpenStreetMap

### Data Processing

- Pandas
- NumPy

---

## Dataset Setup

Place the dataset manually inside:

```text
models/jan to may police violation_anonymized791b166.csv
```

before training.

The dataset is intentionally excluded from GitHub because it exceeds GitHub's 100 MB file size limit.
