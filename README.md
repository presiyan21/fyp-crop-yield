# CropAdvisor

A district-level crop yield advisory system for Indian agriculture. Farmers or agronomists enter their field conditions — irrigation ratio, fertiliser application, and current climate — and the system predicts expected yield, classifies it against the district's historical benchmarks, and generates a set of concrete management actions.

The backend runs ten XGBoost models (one per crop), trained on ICRISAT district data from 1966–2005 and tested on 2006–2015. Predictions come with SHAP-based explanations, conformal confidence intervals, and a full drift monitoring pipeline for tracking model accuracy over time.

---

## Features

- **Advisory generation** — Yield prediction with Green / Amber / Red classification against district historical quartiles, plus ranked management actions
- **SHAP explanations** — Per-prediction signed feature contributions (XGBoost native `pred_contribs`), shown as a local diverging bar chart alongside global crop-average importance
- **Scenario comparison** — Save two sets of input conditions and compare predicted outcomes side by side, including confidence interval overlap verdict
- **Climate auto-fill** — Fetches live weather from Open-Meteo (archive and 16-day forecast) using district coordinates, with OOD warnings when inputs fall outside the training distribution
- **Economic impact** — MSP-based revenue estimate, delta vs district median, and 90% revenue range from Monte Carlo simulation
- **Input optimisation** — Binary search for the minimum irrigation and NPK required to reach district median yield
- **Sensitivity analysis** — Shows yield response to ±30% variation in each user-controllable field
- **Multi-year projection** — Three-season chained yield forecast with trajectory classification
- **Crop ranker** — Runs all ten models in parallel and ranks crops by risk-adjusted expected revenue; includes six climate stress scenario presets
- **History and yield reporting** — Users can accept advisories and later submit actual harvest yields; the system tracks prediction error and classification accuracy
- **Admin panel** — Confusion matrix, CUSUM control charts, ADF stationarity tests, per-crop MAE trends, and a retraining readiness pipeline (admin accounts only)
- **Threshold customisation** — Per-user and per-crop advisory thresholds with agronomic defaults pre-populated
- **PDF export** — Full advisory report and admin summary, both generated client-side

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- A [Supabase](https://supabase.com) project with the schema described below

### 1. Clone the repository

```bash
git clone https://github.com//fyp-crop-yield.git
cd fyp-crop-yield
```

### 2. Backend environment

Create `backend/.env`:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<service-role-key>
```

A template is provided at `backend/.env.example`.

Install dependencies and start the server:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

The API runs on `http://localhost:5000`.

### 3. Frontend environment

Create `frontend/.env`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

A template is provided at `frontend/.env.example`.

Install dependencies and start the dev server:

```bash
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:5173`. All `/api/*` requests proxy automatically to port 5000 — no CORS configuration needed in development.

### 4. Seed demo data 

To populate the demo account with pre-built advisory scenarios:

```bash
cd backend
python seed_demo.py
```

This inserts 60 recommendation and yield report pairs across all ten crops, plus custom threshold settings with three crop-level overrides.

---

## Test credentials

An admin demo account is available with pre-seeded data covering all major features:

| Field | Value |
|---|---|
| Email | `goldsmiths.test.user@gmail.com` |
| Password | *(provided separately)* |
| Role | Admin |

This account has 64 seeded recommendations, 60 yield reports, active crop threshold overrides, and 9 pending notifications.

---

## Running the tests

### Backend

```bash
cd backend
pytest
```

193 tests across 20 files. Markers: `unit`, `bva`, `equivalence`, `integration`, `security`, `performance`, `regression`, `smoke`. Coverage is measured against `services/`, `routes/`, and `middleware/`.

Run a specific marker:

```bash
pytest -m unit
pytest -m security
```

**Note:** pytest must be run from `backend/` so that `pytest.ini` is discovered. Running from the project root causes custom markers to go unrecognised.

### Frontend

```bash
cd frontend
npm test
```

58 Vitest tests covering utility functions (`featureLabels`, `notifications`) and component behaviour (`ErrorBoundary`, `ProtectedRoute`).

To run with coverage:

```bash
npm run test:coverage
```

---

## Database schema

Four tables are required in Supabase:

- **`recommendations`** — stores advisory outputs, user inputs, predicted yield, classification level, and applied thresholds
- **`yield_reports`** — records actual harvest yield against a recommendation, used for drift monitoring
- **`user_thresholds`** — per-user advisory threshold configuration with per-crop overrides stored as JSONB
- **`profiles`** — user roles (`admin` or null), linked to Supabase auth

Row-level security should be configured so users can only read and write their own rows. The `profiles` table requires a trigger to insert a default row on new user sign-up.

---

## Known limitations

- **Training data ends 2005.** The models have no exposure to post-2005 climate trends. Live weather auto-fill mitigates this partially, and OOD warnings flag inputs that fall outside the training distribution, but predictions for current conditions are indicative rather than precise.
- **District-level aggregates only.** The ICRISAT dataset aggregates yields at the district level. Field-level variation within a district is not captured.
- **Pulse crop accuracy is lower.** Chickpea, pigeonpea, pearl millet, sorghum, and cotton models have R² between 0.42 and 0.48. The UI shows confidence tier badges on every advisory to make this transparent.
- **No live price data.** Economic impact calculations use 2024–25 Government of India Minimum Support Prices, which are hardcoded and not fetched dynamically.
- **Optimistic classification bias.** The model predicts above-median yields more often than not on the demo dataset. The confusion matrix in the Admin panel detects and flags this automatically.