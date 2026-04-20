import joblib
import json
import pandas as pd
import numpy as np
from config import MODELS_DIR, SUPPORTED_CROPS

DEFAULT_THRESHOLDS = {
    "irrigation_min":    0.3,
    "npk_min":           50.0,
    "rainfall_dev_low":  -20.0,
    "rainfall_dev_high": 40.0,
    "heat_stress_max":   2.0,
}

_DEFAULT_ADVICE = {
    "irr_low":   "Increase irrigation coverage to reduce drought stress on the crop",
    "npk_low":   "Consider increasing fertilizer application - NPK below recommended level",
    "rain_low":  "Rainfall below normal - supplement with irrigation where possible",
    "rain_high": "Rainfall above normal - monitor for waterlogging and drainage issues",
    "heat":      "Heat stress detected - consider heat-tolerant varieties",
}

_CROP_ADVICE = {
    "rice": {
        "irr_low":   "Rice requires high irrigation coverage - target >=60% area; consider Alternate Wetting & Drying (AWD) to reduce water use by 30% without yield loss",
        "npk_low":   "Apply split nitrogen doses at basal, tillering and panicle initiation stages for rice; top-dress with urea at tillering",
        "rain_low":  "Rainfall deficit is critical for rice - supplement with canal or groundwater irrigation; transplanting delay may be necessary if kharif onset is late",
        "rain_high": "Excess rainfall raises blast and bacterial leaf blight (BLB) disease risk - ensure field drainage and apply preventive fungicide",
        "heat":      "Heat stress causes spikelet sterility in rice - consider short-duration varieties (105-115 days) or adjust transplanting timing to avoid peak temperatures",
    },
    "wheat": {
        "irr_low":   "Wheat needs irrigation at 5 critical stages: crown root initiation (21 days after sowing), tillering, jointing, flowering and grain fill",
        "npk_low":   "Split wheat nitrogen: 50% basal, 25% at first irrigation (CRI), 25% at tillering for optimal grain protein and yield",
        "rain_low":  "Rabi rainfall deficit - prioritise irrigation at flowering and grain fill; these two stages protect most of the yield potential",
        "rain_high": "Excess moisture at maturity increases yellow and brown rust severity and lodging risk in wheat - reduce irrigation accordingly",
        "heat":      "Terminal heat stress reduces wheat 1000-grain weight - consider early sowing (Oct 15 to Nov 15) next season to avoid late-season heat",
    },
    "maize": {
        "irr_low":   "Maize is highly drought-sensitive at tasseling and silking - ensure irrigation covers these 2-week critical windows for pollination",
        "npk_low":   "Maize is a heavy nitrogen feeder - apply at least 120 Kg N/ha in split doses for yield targets above 5 t/ha",
        "rain_low":  "Moisture stress at pollination drastically reduces maize grain set - supplement irrigation during tasseling and silking",
        "rain_high": "Waterlogging for more than 48 hours causes root asphyxiation in maize - open drainage channels immediately",
        "heat":      "High temperatures during pollination reduce maize grain set - consider Rabi maize or evening planting to avoid Kharif heat peaks",
    },
    "sorghum": {
        "irr_low":   "Sorghum is drought-tolerant - irrigation at grain fill gives the best return on water; avoid over-irrigation which suppresses root development",
        "npk_low":   "Apply 60-80 Kg N/ha for sorghum in two splits: basal at sowing and top-dress at 25 days after sowing",
        "rain_low":  "Sorghum tolerates mid-season dry spells well - 1 to 2 protective irrigations at heading and grain fill are usually sufficient",
        "rain_high": "Waterlogging can cause root rot and charcoal rot in sorghum - reduce or halt irrigation in already wet soils",
        "heat":      "Sorghum is heat-tolerant but grain quality (protein, starch) declines above 40 degrees C - consider hybrid varieties rated for heat tolerance",
    },
    "pearl_millet": {
        "irr_low":   "Pearl millet is highly drought-tolerant - 1 to 2 irrigations at flag leaf emergence and grain fill stages are sufficient for most conditions",
        "npk_low":   "Apply 60 Kg N/ha in two splits for pearl millet; phosphorus is critical for tiller development and panicle size",
        "rain_low":  "Pearl millet can tolerate moderate drought - one protective irrigation at 50% flowering will significantly protect grain yield",
        "rain_high": "Pearl millet is susceptible to downy mildew under high humidity - increase plant spacing for airflow and apply metalaxyl seed treatment",
        "heat":      "Pearl millet is among the most heat-tolerant cereals - yield impact from heat stress is substantially lower than for rice, wheat or maize",
    },
    "chickpea": {
        "irr_low":   "Chickpea is largely rainfed - pre-sowing irrigation for moisture establishment plus 1 pod-fill irrigation gives the best yield response",
        "npk_low":   "As a nitrogen-fixing legume, chickpea needs less N - prioritise phosphorus (40-60 Kg P2O5/ha) and sulphur (20 Kg/ha) over heavy N application",
        "rain_low":  "Chickpea tolerates mild drought due to deep roots - one targeted irrigation at pod development stage significantly protects yield",
        "rain_high": "Chickpea is highly susceptible to waterlogging and excess humidity - avoid poorly-drained fields; excess rain at flowering increases Botrytis grey mould risk",
        "heat":      "Heat and drought at flowering cause pod abortion in chickpea - consider desi varieties with shorter maturity (90-100 days) to escape terminal stress",
    },
    "pigeonpea": {
        "irr_low":   "Pigeonpea is drought-tolerant with deep roots - 1 to 2 supplemental irrigations at early flowering and pod fill are adequate; avoid waterlogging",
        "npk_low":   "Pigeonpea fixes nitrogen - apply starter N (20 Kg N/ha) at sowing and ensure good phosphorus availability (40 Kg P2O5/ha) for early establishment",
        "rain_low":  "Pigeonpea roots access deeper moisture reserves - mild to moderate drought stress is usually manageable without supplemental irrigation",
        "rain_high": "Excess rainfall causes Phytophthora stem blight and root rot in pigeonpea - use raised-bed planting in flood-prone areas and choose wilt-resistant varieties",
        "heat":      "Pigeonpea is heat-tolerant but sustained high night temperatures (>30 C) reduce flowering and pod set - monitor variety suitability for the region",
    },
    "groundnut": {
        "irr_low":   "Groundnut pegs need consistent soil moisture - irrigate at pegging (35-45 DAS), pod development and pod fill; moisture deficit at pegging is the most damaging",
        "npk_low":   "Groundnut needs calcium for kernel filling - apply gypsum (200-400 Kg/ha) at pegging in calcium-deficient soils; also ensure adequate boron for pod set",
        "rain_low":  "Moisture stress at pegging and pod fill severely cuts groundnut yield and increases aflatoxin contamination risk - supplement irrigation in these windows",
        "rain_high": "Waterlogging promotes Aspergillus (aflatoxin) and collar rot in groundnut - ensure immediate drainage; avoid further irrigation",
        "heat":      "Heat stress at flowering reduces groundnut pod set - consider bunch type varieties with better heat tolerance (e.g. TG 37A, Kadiri 3)",
    },
    "cotton": {
        "irr_low":   "Cotton responds well to regulated deficit irrigation (70-80% ETc) - concentrate water at boll initiation and boll development for best fibre yield",
        "npk_low":   "Cotton is a heavy potassium feeder - ensure K2O at 60-80 Kg/ha for boll retention and fibre quality; potassium deficiency causes premature boll shedding",
        "rain_low":  "Moisture stress during boll formation (45-90 DAS) causes boll shedding - prioritise irrigation in this 6-week critical window",
        "rain_high": "Excess moisture promotes root rot (Pythium/Phytophthora) and delays boll opening - use furrow irrigation only; avoid flood irrigation in cotton",
        "heat":      "Sustained temperatures above 40 degrees C cause pollen sterility and boll shedding in cotton - maintain adequate soil moisture to buffer heat stress at the root zone",
    },
    "sugarcane": {
        "irr_low":   "Sugarcane has the highest water requirement of major crops - target 1,500-2,500 mm seasonal water; drip irrigation saves 30-40% water and improves cane quality",
        "npk_low":   "Apply 250-300 Kg N/ha for sugarcane in multiple splits over the 12-month season; potassium (150-200 Kg K2O/ha) is critical for sucrose accumulation",
        "rain_low":  "Sugarcane water deficit during the grand growth phase (3-6 months after planting) drastically reduces cane tonnage - supplement irrigation immediately",
        "rain_high": "Waterlogging in sugarcane promotes red rot disease and reduces sucrose content - open drainage furrows and raise planting beds in affected areas",
        "heat":      "Sugarcane is well-adapted to tropical heat; however, very high temperatures at ripening (>35 C) reduce sucrose accumulation - target a cool dry ripening period of 2-3 months",
    },
}

_xgb_models = joblib.load(MODELS_DIR / "xgb_models.pkl")

_feature_cols  = {}
_hist_stats    = {}
_shap_top10    = {}
_yearly_stats  = {}

for crop in SUPPORTED_CROPS:
    with open(MODELS_DIR / f"{crop}_feature_cols.json") as f:
        _feature_cols[crop] = json.load(f)
    _hist_stats[crop] = pd.read_csv(MODELS_DIR / f"{crop}_hist_stats.csv")

    shap_path = MODELS_DIR / f"shap_top10_{crop}.csv"
    if shap_path.exists():
        df = pd.read_csv(shap_path, index_col=0)
        _shap_top10[crop] = df["mean_abs_shap"].to_dict()
    else:
        _shap_top10[crop] = {}

    yearly_path = MODELS_DIR / f"{crop}_yearly_stats.csv"
    if yearly_path.exists():
        _yearly_stats[crop] = pd.read_csv(yearly_path)
    else:
        _yearly_stats[crop] = pd.DataFrame()

_feature_ranges = {}
for crop in SUPPORTED_CROPS:
    ranges_path = MODELS_DIR / f"{crop}_feature_ranges.json"
    if ranges_path.exists():
        with open(ranges_path) as f:
            _feature_ranges[crop] = json.load(f)
    else:
        _feature_ranges[crop] = {}

with open(MODELS_DIR / "ensemble_weights.json") as f:
    _ensemble_weights = json.load(f)

# Conformal prediction calibration - empirical residuals from 2006-2015 test set
# Nonconformity score = |actual - predicted|. q90 gives 90% marginal coverage.
_conformal_quantiles: dict = {}
for _crop in SUPPORTED_CROPS:
    _bt_path = MODELS_DIR / f"{_crop}_backtest.json"
    if not _bt_path.exists():
        _conformal_quantiles[_crop] = None
        continue
    with open(_bt_path) as _f:
        _bt = json.load(_f)
    _resid = [
        abs(float(r["actual"]) - float(r["predicted"]))
        for records in _bt.values()
        for r in records
        if "actual" in r and "predicted" in r
    ]
    if len(_resid) < 10:
        _conformal_quantiles[_crop] = None
        continue
    _arr = np.sort(np.array(_resid))
    _n   = len(_arr)
    _q80 = _arr[min(int(np.ceil((_n + 1) * 0.80)) - 1, _n - 1)]
    _q90 = _arr[min(int(np.ceil((_n + 1) * 0.90)) - 1, _n - 1)]
    _conformal_quantiles[_crop] = {
        "q90": round(float(_q90), 1),
        "q80": round(float(_q80), 1),
        "n_calibration": _n,
    }

# Backtest ADF - stationarity of signed residuals across all 2006-2015 test records.
# Complements conformal calibration: same backtest.json source, signed not absolute.
_backtest_adf: dict = {}
for _crop in SUPPORTED_CROPS:
    _bt_path = MODELS_DIR / f"{_crop}_backtest.json"
    if not _bt_path.exists():
        _backtest_adf[_crop] = None
        continue
    with open(_bt_path) as _f:
        _bt = json.load(_f)
    _signed = [
        float(r["actual"]) - float(r["predicted"])
        for records in _bt.values()
        for r in records
        if "actual" in r and "predicted" in r
    ]
    if len(_signed) < 5:
        _backtest_adf[_crop] = None
        continue
    try:
        from statsmodels.tsa.stattools import adfuller as _adfuller
        _safe = max(0, len(_signed) // 2 - 3)
        _mlag = min(3, len(_signed) // 3, _safe)
        _adf_r = _adfuller(_signed, maxlag=_mlag, autolag="AIC" if _mlag > 0 else None)
        _p_bt = round(float(_adf_r[1]), 4)
        _backtest_adf[_crop] = {
            "adf_stat":       round(float(_adf_r[0]), 3),
            "p_value":        _p_bt,
            "critical_values": {k: round(v, 3) for k, v in _adf_r[4].items()},
            "is_stationary":  _p_bt < 0.05,
            "n_calibration":  len(_signed),
            "interpretation": (
                "Stationary - model calibration is stable across the test period"
                if _p_bt < 0.05 else
                "Non-stationary - systematic drift detected in test residuals"
            ),
        }
    except Exception:
        _backtest_adf[_crop] = None

# District names: {int_code: {name, state}}
_district_names = {}
names_path = MODELS_DIR / "district_names.json"
if names_path.exists():
    with open(names_path) as f:
        _district_names = {int(k): v for k, v in json.load(f).items()}

def get_feature_cols(crop: str) -> list:
    """Return the ordered feature column list for a given crop model."""
    return _feature_cols[crop]

_USER_FIELD_KEYS = {
    "YIELD_LAG_1", "IRRIGATION_RATIO", "NPK_TOTAL_KG_PER_HA",
    "ANNUAL RAINFALL (Millimeters)", "KHARIF_TMAX", "RABI_TMIN",
}

_USER_FIELD_LABELS = {
    "YIELD_LAG_1":                    "Last year's yield",
    "IRRIGATION_RATIO":               "Irrigation ratio",
    "NPK_TOTAL_KG_PER_HA":            "NPK fertilizer",
    "ANNUAL RAINFALL (Millimeters)":  "Annual rainfall",
    "KHARIF_TMAX":                    "Kharif max temperature",
    "RABI_TMIN":                      "Rabi min temperature",
}

def _check_ood(crop: str, features: dict) -> list:
    """Return warning strings for user inputs outside training distribution (>2.5sigma).
    Only checks the 6 user-controllable fields - not auto-filled defaults."""
    ranges   = _feature_ranges.get(crop, {})
    warnings = []
    for key in _USER_FIELD_KEYS:
        if key not in features or key not in ranges:
            continue
        val  = float(features[key])
        r    = ranges[key]
        std  = r["std"]
        if std == 0:
            continue
        sigma = (val - r["mean"]) / std
        label = _USER_FIELD_LABELS.get(key, key)
        if sigma > 2.5:
            warnings.append(
                f"{label} ({val:g}) is {sigma:.1f}sigma above the typical training range "
                f"(training max: {r['max']:g}) - prediction may be less reliable"
            )
        elif sigma < -2.5:
            warnings.append(
                f"{label} ({val:g}) is {abs(sigma):.1f}sigma below the typical training range "
                f"(training min: {r['min']:g}) - prediction may be less reliable"
            )
    return warnings

def predict(crop: str, features: dict) -> float:
    """Raw XGBoost inference - no DB writes, no thresholds, no SHAP.
    Used by 3-year projection and upgrade path binary search to avoid
    polluting the recommendation history with synthetic inputs."""
    X = pd.DataFrame([features])[_feature_cols[crop]]
    return float(_xgb_models[crop].predict(X)[0])

def generate_advisory(crop: str, features: dict, dist_code=None, thresholds: dict | None = None, crop_overrides: dict | None = None) -> dict:
    """Full advisory pipeline: predict -> SHAP -> threshold classification -> actions -> OOD check.
    Threshold override chain: global defaults -> user thresholds -> per-crop overrides.
    Returns the complete advisory dict saved to the recommendations table."""
    import xgboost as xgb

    cols = _feature_cols[crop]
    X    = pd.DataFrame([features])[cols]
    pred = float(_xgb_models[crop].predict(X)[0])

    # Per-prediction SHAP via XGBoost native pred_contribs (~5 ms, no shap library)
    shap_local = {}
    shap_base  = None
    try:
        dmat     = xgb.DMatrix(X)
        contribs = _xgb_models[crop].get_booster().predict(dmat, pred_contribs=True)
        # contribs shape: (1, n_features + 1) - last column is model base value (bias)
        shap_base    = round(float(contribs[0, -1]), 1)
        contrib_vals = contribs[0, :-1]
        all_shap     = {col: round(float(val), 2) for col, val in zip(cols, contrib_vals)}
        # Top 10 by absolute value, keeping sign so frontend can show direction
        shap_local = dict(
            sorted(all_shap.items(), key=lambda x: abs(x[1]), reverse=True)[:10]
        )
    except Exception as e:
        print(f"[WARN] Per-prediction SHAP failed for {crop}: {e}")

    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    # Apply per-crop overrides - takes precedence over global thresholds
    _co = (crop_overrides or {}).get(crop) or {}
    if "irrigation_min" in _co:
        t["irrigation_min"] = float(_co["irrigation_min"])
    if "npk_min" in _co:
        t["npk_min"] = float(_co["npk_min"])
    if "rainfall_dev_low" in _co:
        t["rainfall_dev_low"] = float(_co["rainfall_dev_low"])
    if "rainfall_dev_high" in _co:
        t["rainfall_dev_high"] = float(_co["rainfall_dev_high"])
    if "heat_stress_max" in _co:
        t["heat_stress_max"] = float(_co["heat_stress_max"])

    stats = _hist_stats[crop]
    if dist_code and dist_code in stats["Dist Code"].values:
        row = stats[stats["Dist Code"] == dist_code].iloc[0]
        q25, med, q75 = row["hist_q25"], row["hist_median"], row["hist_q75"]
    else:
        q25 = stats["hist_q25"].median()
        med = stats["hist_median"].median()
        q75 = stats["hist_q75"].median()

    if pred < q25:
        level, headline = "red",   "Below-average yield expected"
    elif pred < med:
        level, headline = "amber", "Slightly below average yield expected"
    elif pred < q75:
        level, headline = "green", "Average to good yield expected"
    else:
        level, headline = "green", "Above-average yield expected"

    crop_advice = _CROP_ADVICE.get(crop, {})

    actions  = []
    irr      = features.get("IRRIGATION_RATIO",    0)
    npk      = features.get("NPK_TOTAL_KG_PER_HA", 0)
    rain_dev = features.get("RAINFALL_DEV_PCT",     0)
    heat     = features.get("HEAT_STRESS",          0)

    if irr      < t["irrigation_min"]:    actions.append(crop_advice.get("irr_low",   _DEFAULT_ADVICE["irr_low"]))
    if npk      < t["npk_min"]:           actions.append(crop_advice.get("npk_low",   _DEFAULT_ADVICE["npk_low"]))
    if rain_dev < t["rainfall_dev_low"]:  actions.append(crop_advice.get("rain_low",  _DEFAULT_ADVICE["rain_low"]))
    if rain_dev > t["rainfall_dev_high"]: actions.append(crop_advice.get("rain_high", _DEFAULT_ADVICE["rain_high"]))
    if heat     > t["heat_stress_max"]:   actions.append(crop_advice.get("heat",      _DEFAULT_ADVICE["heat"]))

    if not actions:
        actions.append("No immediate interventions needed - inputs are within recommended ranges")
    ood_warnings = _check_ood(crop, features)

    ci = _conformal_quantiles.get(crop)
    conformal_interval = None
    if ci:
        q90 = ci["q90"]
        conformal_interval = {
            "lower_90":      round(pred - q90, 1),
            "upper_90":      round(pred + q90, 1),
            "q90":           q90,
            "q80":           ci["q80"],
            "n_calibration": ci["n_calibration"],
            "method":        "split_conformal",
        }

    return {
        "crop":               crop,
        "predicted_yield":    round(pred, 1),
        "hist_median":        round(float(med), 1),
        "hist_q25":           round(float(q25), 1),
        "hist_q75":           round(float(q75), 1),
        "level":              level,
        "headline":           headline,
        "actions":            actions,
        "shap_top10":         _shap_top10.get(crop, {}),
        "shap_local":         shap_local,
        "shap_base":          shap_base,
        "ood_warnings":       ood_warnings,
        "conformal_interval": conformal_interval,
        "backtest_adf":       _backtest_adf.get(crop),
    }

def sensitivity_analysis(crop: str, features: dict) -> dict:
    """Vary each user-controllable field +/-30% in 10% steps, return yield delta at each step."""
    STEPS = [-0.30, -0.20, -0.10, 0.0, +0.10, +0.20, +0.30]
    base = predict(crop, features)
    results = {}
    for key in _USER_FIELD_KEYS:
        val = float(features.get(key, 0))
        if val == 0:
            continue
        pts = []
        for pct in STEPS:
            modified = {**features, key: val * (1 + pct)}
            y = round(predict(crop, modified), 1)
            pts.append({
                "pct":   round(pct * 100),
                "yield": y,
                "delta": round(y - base, 1),
            })
        results[key] = pts
    return {"sensitivity": results, "base_yield": round(base, 1)}

def get_model_info() -> dict:
    """Return feature count and precomputed global SHAP top-10 for every crop.
    Used by the Models page to render the importance bars and domain grid."""
    info = {}
    for crop in SUPPORTED_CROPS:
        info[crop] = {
            "feature_count": len(_feature_cols[crop]),
            "shap_top10":    _shap_top10.get(crop, {}),
        }
    return info

def get_districts(crop: str) -> list:
    """Return district codes + historical stats + names for the dropdown."""
    stats = _hist_stats[crop]
    result = []
    for _, row in stats.sort_values("Dist Code").iterrows():
        code = int(row["Dist Code"])
        name_info = _district_names.get(code, {})
        result.append({
            "code":   code,
            "median": round(float(row["hist_median"]), 1),
            "q25":    round(float(row["hist_q25"]),    1),
            "q75":    round(float(row["hist_q75"]),    1),
            "name":   name_info.get("name", ""),
            "state":  name_info.get("state", ""),
        })
    return result

def get_yearly_trend(crop: str, dist_code: int) -> list:
    """Return annual yield series for a district (1966–2015), falling back to the national median trend if the district has no records."""
    df = _yearly_stats.get(crop)
    if df is None or df.empty:
        return []

    subset = df[df["Dist Code"] == dist_code].copy()

    if subset.empty:
        # Fall back to national median trend
        subset = (
            df.groupby("Year")["yield_kg_ha"]
            .median()
            .reset_index()
        )
    else:
        subset = subset[["Year", "yield_kg_ha"]]

    subset = subset.sort_values("Year").dropna(subset=["yield_kg_ha"])

    return [
        {"year": int(row["Year"]), "yield_kg_ha": round(float(row["yield_kg_ha"]), 1)}
        for _, row in subset.iterrows()
    ]
def get_district_crop_summary(dist_code: int) -> list:
    """Return historical median yield for every crop that has data for this district."""
    result = []
    for crop in SUPPORTED_CROPS:
        stats = _hist_stats[crop]
        row = stats[stats["Dist Code"] == dist_code]
        if not row.empty:
            r = row.iloc[0]
            result.append({
                "crop":   crop,
                "median": round(float(r["hist_median"]), 1),
                "q25":    round(float(r["hist_q25"]),    1),
                "q75":    round(float(r["hist_q75"]),    1),
            })
    return sorted(result, key=lambda x: x["median"], reverse=True)

def get_hist_q25_for_district(crop: str, dist_code: int):
    """Look up hist_q25 for a specific district from the cached hist_stats CSV."""
    stats = _hist_stats.get(crop)
    if stats is None or dist_code is None:
        return None
    row = stats[stats["Dist Code"] == dist_code]
    if row.empty:
        return float(stats["hist_q25"].median())  # national median fallback
    return float(row.iloc[0]["hist_q25"])

def rank_all_crops(features: dict, dist_code: int = None) -> list:
    """Run all 10 XGBoost models with the same inputs, return results ranked by delta vs median."""
    results = []
    for crop in SUPPORTED_CROPS:
        try:
            model = _xgb_models[crop]
            cols  = _feature_cols[crop]

            stats       = _hist_stats.get(crop)
            hist_median = hist_q25 = hist_q75 = None

            if dist_code and stats is not None:
                r = stats[stats["Dist Code"] == dist_code]
                if not r.empty:
                    hist_median = float(r.iloc[0]["hist_median"])
                    hist_q25    = float(r.iloc[0]["hist_q25"])
                    hist_q75    = float(r.iloc[0]["hist_q75"])

            if hist_median is None and stats is not None and not stats.empty:
                hist_median = float(stats["hist_median"].median())
                hist_q25    = float(stats["hist_q25"].median())
                hist_q75    = float(stats["hist_q75"].median())

            if hist_median is None:
                hist_median = 0.0
                hist_q25    = 0.0
                hist_q75    = 0.0

            # Build feature row - auto-fill YIELD_LAG_1 from district median 
            row = {}
            for col in cols:
                if col == "YIELD_LAG_1" and col not in features and hist_median > 0:
                    row[col] = hist_median   # sensible prior: last year ~ typical yield
                else:
                    row[col] = float(features.get(col, 0))

            # Predict 
            X    = pd.DataFrame([row])[cols]
            pred = float(model.predict(X)[0])
            pred = max(0.0, round(pred, 1))

            level = "red" if pred < hist_q25 else ("amber" if pred < hist_median else "green")
            delta     = round(pred - hist_median, 1)
            delta_pct = round((delta / hist_median * 100) if hist_median > 0 else 0, 1)

            results.append({
                "crop":            crop,
                "predicted_yield": pred,
                "hist_median":     round(hist_median, 1),
                "hist_q25":        round(hist_q25, 1),
                "hist_q75":        round(hist_q75, 1),
                "level":           level,
                "delta":           delta,
                "delta_pct":       delta_pct,
            })
        except Exception as e:
            print(f"[WARN] rank_all_crops skipped {crop}: {e}")

    return sorted(results, key=lambda x: x["delta_pct"], reverse=True)

def get_national_training_climate() -> dict:
    """Return national training-era averages for the three user-controllable climate features.
    Uses rice as the reference crop (broadest district coverage, 1966-2005 training data)."""
    ranges = _feature_ranges.get("rice", {})
    result = {}
    for key in ["ANNUAL RAINFALL (Millimeters)", "KHARIF_TMAX", "RABI_TMIN"]:
        if key in ranges:
            result[key] = {
                "mean": round(ranges[key]["mean"], 1),
                "std":  round(ranges[key]["std"],  1),
            }
    return result

_WEATHER_KEYS_MC = [
    "ANNUAL RAINFALL (Millimeters)",
    "KHARIF_TMAX",
    "RABI_TMIN",
]

def monte_carlo_uncertainty(crop: str, features: dict, dist_code=None, n: int = 1000) -> dict:
    """Propagate weather input uncertainty through XGBoost via Monte Carlo sampling.

    Each weather input is sampled from N(current_value, (0.3 * training_std)^2),
    representing realistic inter-seasonal variability around the auto-filled value.
    Non-weather inputs (irrigation, fertiliser, yield lag) are held fixed."""
    ranges = _feature_ranges.get(crop, {})
    cols   = _feature_cols[crop]

    base_row = {col: float(features.get(col, 0)) for col in cols}
    rng = np.random.default_rng()

    rows = []
    for _ in range(n):
        row = dict(base_row)
        for key in _WEATHER_KEYS_MC:
            if key in ranges and key in features:
                sigma = ranges[key]["std"] * 0.3
                sample = float(rng.normal(features[key], sigma))
                row[key] = max(0.0, sample)
        rows.append(row)

    X = pd.DataFrame(rows)[cols]
    yields_arr = _xgb_models[crop].predict(X)

    stats = _hist_stats[crop]
    if dist_code and dist_code in stats["Dist Code"].values:
        r      = stats[stats["Dist Code"] == dist_code].iloc[0]
        q25    = float(r["hist_q25"])
        median = float(r["hist_median"])
    else:
        q25    = float(stats["hist_q25"].median())
        median = float(stats["hist_median"].median())

    level_counts = {"red": 0, "amber": 0, "green": 0}
    for y in yields_arr:
        if y < q25:
            level_counts["red"] += 1
        elif y < median:
            level_counts["amber"] += 1
        else:
            level_counts["green"] += 1
    level_probs = {k: round(v / n * 100) for k, v in level_counts.items()}

    return {
        "p10":  round(float(np.percentile(yields_arr, 10)),  1),
        "p25":  round(float(np.percentile(yields_arr, 25)),  1),
        "p50":  round(float(np.percentile(yields_arr, 50)),  1),
        "p75":  round(float(np.percentile(yields_arr, 75)),  1),
        "p90":  round(float(np.percentile(yields_arr, 90)),  1),
        "mean": round(float(np.mean(yields_arr)),             1),
        "std":  round(float(np.std(yields_arr)),              1),
        "iqr":  round(float(np.percentile(yields_arr, 75) - np.percentile(yields_arr, 25)), 1),
        "n_simulations":      n,
        "level_probabilities": level_probs,
        "hist_q25":  round(q25, 1),
        "hist_median": round(median, 1),
    }

def compute_cusum(errors: list, k_factor: float = 0.5, h_factor: float = 5.0) -> dict:
    """Two-sided CUSUM for sequential drift detection in prediction errors.

       Under H0, errors are i.i.d. ~0 and CUSUM stays near zero. Under H1 (systematic
       bias), it accumulates until crossing h, signalling drift. k_factor is the
       allowance (0.5σ typical); h_factor is the alarm threshold (5σ typical)."""
    if len(errors) < 2:
        return {
            "cusum_pos": [], "cusum_neg": [],
            "drift_detected": False, "drift_direction": None,
            "threshold": None, "n_errors": len(errors),
        }

    sigma = float(np.std(errors))
    if sigma < 1e-6:
        sigma = 1.0

    k = k_factor * sigma
    h = h_factor * sigma

    c_pos, c_neg = [0.0], [0.0]
    for e in errors:
        c_pos.append(max(0.0, c_pos[-1] + e - k))
        c_neg.append(max(0.0, c_neg[-1] - e - k))

    c_pos = c_pos[1:]
    c_neg = c_neg[1:]

    # Standard CUSUM: alarm fires when statistic FIRST crosses threshold,
    # even if it subsequently recovers. Check entire history, not just final value.
    drift_pos_idx = next((i for i, v in enumerate(c_pos) if v > h), None)
    drift_neg_idx = next((i for i, v in enumerate(c_neg) if v > h), None)
    drift_pos = drift_pos_idx is not None
    drift_neg = drift_neg_idx is not None

    if drift_pos and drift_neg:
        # Both crossed - whichever crossed first wins
        direction = "underestimating" if drift_pos_idx <= drift_neg_idx else "overestimating"
    elif drift_pos:
        direction = "underestimating"
    elif drift_neg:
        direction = "overestimating"
    else:
        direction = None

    # First crossing index (1-based report number for readability)
    alarm_at = None
    if drift_pos_idx is not None and drift_neg_idx is not None:
        alarm_at = min(drift_pos_idx, drift_neg_idx) + 1
    elif drift_pos_idx is not None:
        alarm_at = drift_pos_idx + 1
    elif drift_neg_idx is not None:
        alarm_at = drift_neg_idx + 1

    return {
        "cusum_pos":       [round(v, 1) for v in c_pos],
        "cusum_neg":       [round(v, 1) for v in c_neg],
        "threshold":       round(h, 1),
        "k_allowance":     round(k, 1),
        "sigma":           round(sigma, 1),
        "drift_detected":  drift_pos or drift_neg,
        "drift_direction": direction,
        "alarm_at_report": alarm_at,
        "n_errors":        len(errors),
        "final_c_pos":     round(c_pos[-1], 1),
        "final_c_neg":     round(c_neg[-1], 1),
    }

def compute_adf_stationarity(errors: list) -> dict:
    """ADF test for unit root in the prediction error series.

       Reject H0 (p < 0.05): errors are stationary, calibration is stable.
       Fail to reject: unit root possible, systematic drift cannot be ruled out."""
    if len(errors) < 5:
        return {
            "n_errors": len(errors),
            "adf_stat": None, "p_value": None,
            "critical_values": None, "is_stationary": None,
            "interpretation": "Insufficient data (need >= 5 reports)",
        }
    from statsmodels.tsa.stattools import adfuller
    # Safe maxlag: statsmodels requires maxlag < (nobs/2 - 1 - ntrend).
    # With default constant term (ntrend=1): safe ceiling = floor(nobs/2) - 3.
    _safe_max = max(0, len(errors) // 2 - 3)
    _maxlag = min(3, len(errors) // 3, _safe_max)
    result = adfuller(errors, maxlag=_maxlag, autolag="AIC" if _maxlag > 0 else None)
    p_value = round(float(result[1]), 4)
    is_stationary = p_value < 0.05
    return {
        "adf_stat":        round(float(result[0]), 3),
        "p_value":         p_value,
        "critical_values": {k: round(v, 3) for k, v in result[4].items()},
        "is_stationary":   is_stationary,
        "n_errors":        len(errors),
        "interpretation": (
            "Error series is stationary - model calibration is stable"
            if is_stationary else
            "Error series may be non-stationary - systematic drift possible"
        ),
    }

_MSP_PER_QUINTAL = {
    "rice": 2300, "wheat": 2275, "maize": 2090, "sorghum": 3371,
    "pearl_millet": 2500, "chickpea": 5440, "pigeonpea": 7000,
    "groundnut": 6377, "cotton": 7121, "sugarcane": 340,
}

def risk_compare_all_crops(features: dict, dist_code: int = None, n: int = 500) -> list:
    """Run Monte Carlo for all 10 crops under identical conditions.
    Returns risk-adjusted comparison: expected revenue, worst-case (P10),
    red probability, and risk-adjusted score."""
    results = []
    for crop in SUPPORTED_CROPS:
        try:
            cols  = _feature_cols[crop]
            stats = _hist_stats[crop]

            if dist_code and dist_code in stats["Dist Code"].values:
                row = stats[stats["Dist Code"] == dist_code].iloc[0]
                q25    = float(row["hist_q25"])
                median = float(row["hist_median"])
            else:
                q25    = float(stats["hist_q25"].median())
                median = float(stats["hist_median"].median())

            # Build feature row - auto-fill YIELD_LAG_1 from district median
            crop_features = {}
            for col in cols:
                if col == "YIELD_LAG_1" and col not in features:
                    crop_features[col] = median
                else:
                    crop_features[col] = float(features.get(col, 0))

            X_single = pd.DataFrame([crop_features])[cols]
            point_yield = float(_xgb_models[crop].predict(X_single)[0])

            ranges = _feature_ranges.get(crop, {})
            base_row = {col: float(crop_features.get(col, 0)) for col in cols}
            rng = np.random.default_rng()

            rows = []
            for _ in range(n):
                row_mc = dict(base_row)
                for key in _WEATHER_KEYS_MC:
                    if key in ranges and key in crop_features:
                        sigma = ranges[key]["std"] * 0.3
                        row_mc[key] = max(0.0, float(rng.normal(crop_features[key], sigma)))
                rows.append(row_mc)

            X_mc = pd.DataFrame(rows)[cols]
            yields = _xgb_models[crop].predict(X_mc)

            p10 = float(np.percentile(yields, 10))
            p50 = float(np.percentile(yields, 50))
            p90 = float(np.percentile(yields, 90))

            red_count = int(np.sum(yields < q25))
            red_pct   = round(red_count / n * 100)

            msp = _MSP_PER_QUINTAL.get(crop, 0)
            expected_revenue = round((p50 / 100) * msp)
            worst_revenue    = round((p10 / 100) * msp)
            best_revenue     = round((p90 / 100) * msp)

            # Sortino-like score: expected revenue penalised by red probability
            risk_adj = round(expected_revenue * (1 - red_pct / 100))

            level = "red" if point_yield < q25 else ("amber" if point_yield < median else "green")

            results.append({
                "crop":             crop,
                "predicted_yield":  round(point_yield, 1),
                "p10":              round(p10, 1),
                "p50":              round(p50, 1),
                "p90":              round(p90, 1),
                "hist_median":      round(median, 1),
                "hist_q25":         round(q25, 1),
                "level":            level,
                "red_probability":  red_pct,
                "msp":              msp,
                "expected_revenue": expected_revenue,
                "worst_revenue":    worst_revenue,
                "best_revenue":     best_revenue,
                "risk_adjusted":    risk_adj,
            })
        except Exception as e:
            print(f"[WARN] risk_compare skipped {crop}: {e}")

    return sorted(results, key=lambda x: x["risk_adjusted"], reverse=True)

def compute_season_conditions(crop: str, features: dict) -> dict:
    """Compare current season's weather inputs to this crop's training distribution.
       Returns a signal per weather variable and an overall verdict."""
    ranges = _feature_ranges.get(crop, {})

    _WEATHER_META = [
        {"key": "ANNUAL RAINFALL (Millimeters)", "label": "Rainfall",       "low_bad": True,  "high_bad": False},
        {"key": "KHARIF_TMAX",                   "label": "Kharif max temp","low_bad": False, "high_bad": True },
        {"key": "RABI_TMIN",                     "label": "Rabi min temp",  "low_bad": True,  "high_bad": False},
    ]

    signals = []
    n_challenging = 0

    for meta in _WEATHER_META:
        key = meta["key"]
        if key not in features or key not in ranges:
            continue
        r = ranges[key]
        if r.get("std", 0) == 0:
            continue
        val = float(features[key])
        z   = (val - r["mean"]) / r["std"]

        # Status: is the deviation in the bad direction?
        bad_dir = (z < 0 and meta["low_bad"]) or (z > 0 and meta["high_bad"])
        if bad_dir and abs(z) >= 1.5:
            status = "challenging"; n_challenging += 1
        elif bad_dir and abs(z) >= 0.7:
            status = "watch"
        else:
            status = "normal"

        is_temp = "Millimeters" not in key
        if is_temp:
            diff_str = f"{'+' if z > 0 else ''}{(val - r['mean']):.1f}degC vs avg ({r['mean']:.1f}degC)"
        else:
            pct = (val - r["mean"]) / r["mean"] * 100
            diff_str = f"{'+' if pct > 0 else ''}{pct:.0f}% vs avg ({r['mean']:.0f} mm)"

        signals.append({
            "key":    key,
            "label":  meta["label"],
            "status": status,
            "diff_str": diff_str,
            "z_score": round(z, 2),
        })

    overall = "favourable" if n_challenging == 0 else ("mixed" if n_challenging == 1 else "challenging")

    # Key driver = most extreme signal in the bad direction
    bad = [s for s in signals if s["status"] in ("challenging", "watch")]
    key_driver = max(bad, key=lambda s: abs(s["z_score"]), default=None)

    return {
        "overall":          overall,
        "signals":          signals,
        "key_driver_label": key_driver["label"]    if key_driver else None,
        "key_driver_diff":  key_driver["diff_str"] if key_driver else None,
    }

_OPTIMISABLE_FIELDS = [
    {"key": "IRRIGATION_RATIO",    "label": "Irrigation ratio", "unit": "ratio (0-1)", "max": 0.95},
    {"key": "NPK_TOTAL_KG_PER_HA", "label": "NPK fertilizer",  "unit": "Kg/ha",        "max": 400.0},
]

def _find_combined_path(crop: str, full_features: dict, target: float,
                         max_irr: float = 0.95, max_npk: float = 400.0,
                         n_steps: int = 25) -> dict | None:
    """Minimum combined irrigation+NPK intervention to reach target yield.
    Sweeps irrigation in n_steps, binary-searches minimum NPK at each level.
    Returns combination with minimum normalised total effort, or None if infeasible."""
    if predict(crop, {**full_features, "IRRIGATION_RATIO": max_irr, "NPK_TOTAL_KG_PER_HA": max_npk}) < target:
        return None

    irr_cur   = float(full_features.get("IRRIGATION_RATIO", 0))
    npk_cur   = float(full_features.get("NPK_TOTAL_KG_PER_HA", 0))
    irr_range = max(max_irr - irr_cur, 1e-6)
    npk_range = max(max_npk - npk_cur, 1e-6)
    best, best_effort = None, float("inf")

    for i in range(n_steps + 1):
        irr_try = irr_cur + (irr_range * i / n_steps)
        lo, hi  = npk_cur, max_npk
        if predict(crop, {**full_features, "IRRIGATION_RATIO": irr_try, "NPK_TOTAL_KG_PER_HA": hi}) < target:
            continue
        for _ in range(40):
            mid = (lo + hi) / 2.0
            if predict(crop, {**full_features, "IRRIGATION_RATIO": irr_try, "NPK_TOTAL_KG_PER_HA": mid}) >= target:
                hi = mid
            else:
                lo = mid
            if hi - lo < 0.5:
                break
        npk_try = hi
        effort  = (irr_try - irr_cur) / irr_range + (npk_try - npk_cur) / npk_range
        if effort < best_effort:
            best_effort = effort
            best = {
                "irr":   irr_try,
                "npk":   npk_try,
                "yield": float(predict(crop, {**full_features, "IRRIGATION_RATIO": irr_try, "NPK_TOTAL_KG_PER_HA": npk_try})),
            }
    return best

def optimize_inputs(crop: str, features: dict, dist_code=None) -> dict:
    """Find the minimum irrigation and NPK increase needed to reach district median yield.
       Each field is searched independently (binary search, ≤40 iterations, tolerance 1e-4),
       then _find_combined_path() finds the minimum joint effort. Weather-constrained cases
       return an infeasible verdict."""
    cols = _feature_cols[crop]
    stats = _hist_stats[crop]
    if dist_code and dist_code in stats["Dist Code"].values:
        row         = stats[stats["Dist Code"] == dist_code].iloc[0]
        hist_median = float(row["hist_median"])
    else:
        hist_median = float(stats["hist_median"].median())

    # Build a complete feature row - pad non-user columns with training means, not zeros
    ranges = _feature_ranges.get(crop, {})
    full_features = {}
    for col in cols:
        if col in features:
            full_features[col] = float(features[col])
        elif col in ranges:
            full_features[col] = float(ranges[col]["mean"])
        else:
            full_features[col] = 0.0

    base_pred = predict(crop, full_features)

    if base_pred >= hist_median:
        return {
            "already_green": True,
            "base_yield":    round(base_pred, 1),
            "target_yield":  round(hist_median, 1),
            "optimizations": [],
        }

    def _binary_search(key, lo, hi, target, max_iter=40):
        test_hi = {**full_features, key: hi}
        if predict(crop, test_hi) < target:
            return None
        for _ in range(max_iter):
            mid = (lo + hi) / 2.0
            if predict(crop, {**full_features, key: mid}) >= target:
                hi = mid
            else:
                lo = mid
            if (hi - lo) < 1e-4:
                break
        return hi

    optimizations = []
    for fm in _OPTIMISABLE_FIELDS:
        key     = fm["key"]
        current = float(full_features.get(key, 0))
        max_val = fm["max"]
        prec    = 3 if "RATIO" in key else 1

        if current >= max_val:
            continue

        recommended = _binary_search(key, current, max_val, hist_median)
        if recommended is None:
            optimizations.append({
                "field": key, "label": fm["label"], "unit": fm["unit"],
                "current": round(current, prec), "feasible": False,
                "reason": (f"Even at maximum realistic value ({max_val} {fm['unit']}), "
                           "yield stays below the district median under current weather conditions. "
                           "Weather inputs are the binding constraint."),
            })
        else:
            new_yield  = predict(crop, {**full_features, key: recommended})
            change_pct = round((recommended - current) / max(current, 1e-3) * 100, 1)
            optimizations.append({
                "field":       key,        "label":      fm["label"],
                "unit":        fm["unit"], "current":    round(current, prec),
                "recommended": round(recommended, prec),
                "change":      round(recommended - current, prec),
                "change_pct":  change_pct,
                "new_yield":   round(new_yield, 1),
                "yield_gain":  round(new_yield - base_pred, 1),
                "feasible":    True,
            })

    # Combined path - minimum joint irrigation+NPK to reach target
    _irr_cur = float(full_features.get("IRRIGATION_RATIO", 0))
    _npk_cur = float(full_features.get("NPK_TOTAL_KG_PER_HA", 0))
    combined_path = None
    _cb = _find_combined_path(crop, full_features, hist_median)
    if _cb:
        combined_path = {
            "irr_current":     round(_irr_cur, 3),
            "irr_recommended": round(_cb["irr"], 3),
            "irr_change":      round(_cb["irr"] - _irr_cur, 3),
            "irr_change_pct":  round((_cb["irr"] - _irr_cur) / max(_irr_cur, 1e-3) * 100, 1),
            "npk_current":     round(_npk_cur, 1),
            "npk_recommended": round(_cb["npk"], 1),
            "npk_change":      round(_cb["npk"] - _npk_cur, 1),
            "npk_change_pct":  round((_cb["npk"] - _npk_cur) / max(_npk_cur, 1e-3) * 100, 1),
            "new_yield":       round(_cb["yield"], 1),
            "yield_gain":      round(_cb["yield"] - base_pred, 1),
        }

    return {
        "already_green": False,
        "base_yield":    round(base_pred, 1),
        "target_yield":  round(hist_median, 1),
        "gap":           round(hist_median - base_pred, 1),
        "optimizations": optimizations,
        "combined_path": combined_path,
    }

