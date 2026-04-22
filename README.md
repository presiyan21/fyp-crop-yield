# CropAdvisor
**Live demo:** https://fyp-crop-yield.vercel.app

Sign in with the test account below, no install required.

The backend runs on Render's free tier, which sleeps after 15 minutes idle. The first request after a quiet period takes 30–50 seconds to wake up. Everything after that is fast.

CropAdvisor is a decision-support tool for crop yield advisory. Users enter field conditions — irrigation, fertiliser application, and seasonal climate — and the system predicts expected yield, classifies it against district-level historical benchmarks, and returns a prioritised set of management actions. The underlying models are trained on the ICRISAT district dataset (India, 1966–2005), which provides the depth of historical yield records needed to build and evaluate a meaningful ML pipeline.

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

## Running the system locally

The backend and frontend both connect to the hosted Supabase project used by the live demo. No database setup or data seeding is needed — the credentials in `.env.example` point to the existing project with all demo data already loaded.

### Prerequisites

- Python 3.11+
- Node.js 20+

### 1. Clone the repository

```bash
git clone https://github.com/presiyan21/fyp-crop-yield.git
cd fyp-crop-yield
```

### 2. Backend

```bash
cp backend/.env.example backend/.env
cd backend
pip install -r requirements.txt
python app.py
```

The API runs on `http://localhost:5000`.

### 3. Frontend

```bash
cp frontend/.env.example frontend/.env
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:5173`. All `/api/*` requests proxy automatically to port 5000 — no CORS configuration needed in development.

---

## Test credentials

| Field | Value |
|---|---|
| Email | `goldsmiths.test.user@gmail.com` |
| Password | `goldsmiths` |
| Role | Admin |

This account has 64 seeded recommendations, 60 yield reports, active crop threshold overrides, and 9 pending notifications.

---

## Walkthrough

Use the admin account above. The steps below cover all the main features in a logical order — the whole thing takes about 10 minutes.

### 1. Get an advisory

1. Log in and you land on the Dashboard.
2. Select **Rice** from the crop dropdown.
3. Select **Lucknow** from the district dropdown (type it to filter).
4. Click **Load weather data** — the six climate fields fill automatically from the Open-Meteo archive. You will see a small comparison note next to each value showing how current conditions compare to the training baseline.
5. Click **Get Advisory**.

The advisory card loads with a traffic-light classification, predicted yield against the district median, a SHAP bar chart showing which inputs drove the prediction, a confidence interval band, and a set of management actions. The classification is Green / Amber / Red based on where the predicted yield falls in the district's historical quartile distribution.

If any input falls more than 2.5 standard deviations outside the training distribution, an out-of-distribution warning appears above the actions.

### 2. Compare two scenarios

1. With the Rice advisory still showing, click **Save as Scenario A**.
2. Change the **Irrigation ratio** field to `0.2`.
3. Click **Get Advisory** again.
4. Click **Compare with Scenario A**.

The comparison panel shows both predictions side by side, the yield delta, whether the confidence intervals overlap, and which changed inputs appear in the SHAP top 10 for either scenario.

### 3. Check history

Go to **History** in the navigation. The table shows all 64 seeded recommendations. Expand any row to see the full input set, applied thresholds, and — where a yield report exists — the actual vs predicted yield and classification accuracy verdict.

The two rows without a yield report show an **Accept** button and a harvest nudge, which is how real users would submit their actual outcome after harvest.

### 4. Admin panel

Go to **Admin** (visible because the account has the admin role).

- **Confusion matrix** — shows predicted vs actual classification across all 60 reported recommendations. An optimistic bias banner appears automatically if the model issued no Red advisories but actual Red outcomes exist in the data.
- **CUSUM charts** — one per crop, tracking cumulative prediction error over time. A red marker appears at the point where drift was first detected.
- **Retraining pipeline** — click **Simulate** on any crop to step through the five-stage readiness check.

### 5. Threshold settings

Go to **Settings**. The global thresholds are pre-populated. Scroll to **Per-crop overrides**, toggle on **Rice**, and you will see the five-field override grid with the seeded values. Change a value and click **Save** — the change persists and the next advisory for that crop will use the updated thresholds, which are stored in `applied_thresholds` on the recommendation row.

### 6. Notifications

Click the bell icon in the top navigation. Two harvest-due alerts and several planting-window alerts are listed. Clicking a harvest alert links directly to the relevant History row.

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

## Known limitations

- **Training data ends 2005.** The models have no exposure to post-2005 climate trends. Live weather auto-fill mitigates this partially, and OOD warnings flag inputs that fall outside the training distribution, but predictions for current conditions are indicative rather than precise.
- **District-level aggregates only.** The ICRISAT dataset aggregates yields at the district level. Field-level variation within a district is not captured.
- **Pulse crop accuracy is lower.** Chickpea, pigeonpea, pearl millet, sorghum, and cotton models have R² between 0.42 and 0.48. The UI shows confidence tier badges on every advisory to make this transparent.
- **No live price data.** Economic impact calculations use 2024–25 Government of India Minimum Support Prices, which are hardcoded and not fetched dynamically.
- **Optimistic classification bias.** The model predicts above-median yields more often than not on the demo dataset. The confusion matrix in the Admin panel detects and flags this automatically.

---

## Submission

> **Submission tag:** `v1.0-submission`
> ```
> git clone https://github.com/presiyan21/fyp-crop-yield.git
> cd fyp-crop-yield
> git checkout v1.0-submission
> ```