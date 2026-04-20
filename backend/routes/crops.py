from flask import Blueprint, jsonify, request
import json
import time
from pathlib import Path
import requests as http_requests
from config import BASE_DIR
from services.model_service import get_feature_cols, get_model_info, get_districts, get_yearly_trend, get_district_crop_summary, rank_all_crops, sensitivity_analysis, get_national_training_climate, monte_carlo_uncertainty, risk_compare_all_crops, compute_season_conditions, optimize_inputs as optimize_inputs_service
from config import SUPPORTED_CROPS

crops_bp = Blueprint("crops", __name__)


@crops_bp.route("/api/crops", methods=["GET"])
def list_crops():
    return jsonify({"crops": SUPPORTED_CROPS})


@crops_bp.route("/api/crops/<crop>/schema", methods=["GET"])
def crop_schema(crop):
    crop = crop.lower()
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404
    return jsonify({"crop": crop, "features": get_feature_cols(crop)})


@crops_bp.route("/api/crops/<crop>/districts", methods=["GET"])
def crop_districts(crop):
    crop = crop.lower()
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404
    return jsonify({"crop": crop, "districts": get_districts(crop)})


@crops_bp.route("/api/crops/<crop>/trend", methods=["GET"])
def crop_trend(crop):
    crop = crop.lower()
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404

    dist_code = request.args.get("dist_code", type=int)
    if dist_code is None:
        return jsonify({"error": "dist_code query param required"}), 400

    trend = get_yearly_trend(crop, dist_code)
    return jsonify({
        "crop":      crop,
        "dist_code": dist_code,
        "trend":     trend,
    })


@crops_bp.route("/api/model-info", methods=["GET"])
def model_info():
    return jsonify(get_model_info())

@crops_bp.route("/api/districts/<int:dist_code>/crops", methods=["GET"])
def district_crop_summary(dist_code):
    summary = get_district_crop_summary(dist_code)
    if not summary:
        return jsonify({"error": "District not found in any crop dataset"}), 404
    return jsonify({"dist_code": dist_code, "crops": summary})

@crops_bp.route("/api/crops/rank", methods=["POST"])
def rank_crops():
    data      = request.get_json() or {}
    features  = data.get("features", {})
    dist_code = data.get("dist_code")
    if dist_code is not None:
        try:    dist_code = int(dist_code)
        except: dist_code = None
    ranked = rank_all_crops(features, dist_code)
    return jsonify({"ranked": ranked, "dist_code": dist_code})

@crops_bp.route("/api/sensitivity", methods=["POST"])
def sensitivity():
    data      = request.get_json() or {}
    crop      = data.get("crop", "").lower()
    features  = data.get("features", {})
    dist_code = data.get("dist_code")
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404
    if dist_code is not None:
        try:    dist_code = int(dist_code)
        except: dist_code = None
    result = sensitivity_analysis(crop, features)
    return jsonify(result)

@crops_bp.route("/api/montecarlo", methods=["POST"])
def monte_carlo():
    data      = request.get_json() or {}
    crop      = data.get("crop", "").lower()
    features  = data.get("features", {})
    dist_code = data.get("dist_code")
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404
    if dist_code is not None:
        try:    dist_code = int(dist_code)
        except: dist_code = None
    result = monte_carlo_uncertainty(crop, features, dist_code, n=1000)
    return jsonify(result)

@crops_bp.route("/api/crops/risk-compare", methods=["POST"])
def risk_compare():
    data      = request.get_json() or {}
    features  = data.get("features", {})
    dist_code = data.get("dist_code")
    if dist_code is not None:
        try:    dist_code = int(dist_code)
        except: dist_code = None
    results = risk_compare_all_crops(features, dist_code, n=500)
    return jsonify({"crops": results, "dist_code": dist_code})

@crops_bp.route("/api/crops/season-conditions", methods=["POST"])
def season_conditions():
    data     = request.get_json() or {}
    crop     = data.get("crop", "").lower()
    features = data.get("features", {})
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404
    result = compute_season_conditions(crop, features)
    return jsonify(result)

_weather_cache = {}
_COORDS = None
CACHE_TTL = 86400  # 24-hour TTL

def _load_coords():
    global _COORDS
    if _COORDS is None:
        p = Path(BASE_DIR) / "models" / "district_coordinates.json"
        if p.exists():
            with open(p) as f:
                _COORDS = json.load(f)
        else:
            _COORDS = {}
    return _COORDS

@crops_bp.route("/api/districts/<int:dist_code>/weather", methods=["GET"])
def district_weather(dist_code):
    """Fetch seasonal climate data for a district via Open-Meteo (free, no key)."""
    cached = _weather_cache.get(dist_code)
    if cached and time.time() - cached["ts"] < CACHE_TTL:
        return jsonify({**cached["data"], "cached": True})

    coords = _load_coords()
    entry  = coords.get(str(dist_code))
    if not entry:
        return jsonify({"error": "Coordinates not available for this district"}), 404

    lat, lon = entry["lat"], entry["lon"]

    try:
        from datetime import date, timedelta
        end   = date.today() - timedelta(days=1)
        start = end - timedelta(days=365)

        url = "https://archive-api.open-meteo.com/v1/archive"
        params = {
            "latitude":        lat,
            "longitude":       lon,
            "start_date":      start.isoformat(),
            "end_date":        end.isoformat(),
            "daily":           "temperature_2m_max,temperature_2m_min,precipitation_sum",
            "timezone":        "Asia/Kolkata",
        }
        resp = http_requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        d = resp.json().get("daily", {})

        dates  = d.get("time", [])
        tmax   = d.get("temperature_2m_max", [])
        tmin   = d.get("temperature_2m_min", [])
        precip = d.get("precipitation_sum", [])

        kharif_tmax_vals, rabi_tmin_vals, annual_rain = [], [], 0.0

        for i, dt in enumerate(dates):
            month = int(dt[5:7])
            p     = precip[i] or 0
            annual_rain += p
            if month in (6, 7, 8, 9) and tmax[i] is not None:
                kharif_tmax_vals.append(tmax[i])
            if month in (11, 12, 1, 2) and tmin[i] is not None:
                rabi_tmin_vals.append(tmin[i])

        training_climate = get_national_training_climate()
        result = {
            "annual_rainfall_mm": round(annual_rain, 1),
            "kharif_tmax":        round(sum(kharif_tmax_vals) / len(kharif_tmax_vals), 1) if kharif_tmax_vals else None,
            "rabi_tmin":          round(sum(rabi_tmin_vals)   / len(rabi_tmin_vals),   1) if rabi_tmin_vals   else None,
            "source":             "Open-Meteo (past 12 months)",
            "district":           entry.get("name"),
            "training_avg": {
                "annual_rainfall_mm": training_climate.get("ANNUAL RAINFALL (Millimeters)", {}).get("mean"),
                "kharif_tmax":        training_climate.get("KHARIF_TMAX", {}).get("mean"),
                "rabi_tmin":          training_climate.get("RABI_TMIN", {}).get("mean"),
            },
            "cached":             False,
        }

        # Rainfall percentile vs 10 complete calendar years
        try:
            hist_end   = date(end.year - 1, 12, 31)   # e.g. 2024-12-31
            hist_start = date(end.year - 11, 1,  1)   # e.g. 2015-01-01  → 10 years
            resp10 = http_requests.get(url, params={
                "latitude":   lat, "longitude": lon,
                "start_date": hist_start.isoformat(),
                "end_date":   hist_end.isoformat(),
                "daily":      "precipitation_sum,temperature_2m_max,temperature_2m_min",
                "timezone":   "Asia/Kolkata",
            }, timeout=20)
            resp10.raise_for_status()
            d10 = resp10.json().get("daily", {})

            yearly_totals: dict[int, float] = {}
            kharif_tmax_all, rabi_tmin_all = [], []

            times10  = d10.get("time", [])
            precip10 = d10.get("precipitation_sum", [])
            tmax10   = d10.get("temperature_2m_max", [])
            tmin10   = d10.get("temperature_2m_min", [])

            for i, dt in enumerate(times10):
                yr    = int(dt[:4])
                month = int(dt[5:7])
                p     = precip10[i] or 0
                yearly_totals[yr] = yearly_totals.get(yr, 0) + p
                if month in (6, 7, 8, 9) and i < len(tmax10) and tmax10[i] is not None:
                    kharif_tmax_all.append(tmax10[i])
                if month in (11, 12, 1, 2) and i < len(tmin10) and tmin10[i] is not None:
                    rabi_tmin_all.append(tmin10[i])

            totals = sorted(yearly_totals.values())
            current_rain = result["annual_rainfall_mm"]
            pct = (round(sum(1 for t in totals if t < current_rain) / len(totals) * 100)
                   if totals else None)
            result["annual_rainfall_percentile"] = pct
            result["annual_rainfall_10yr_avg"]   = round(sum(totals) / len(totals), 1) if totals else None
            result["years_analysed"]             = len(yearly_totals)
            result["district_avg"] = {
                "annual_rainfall_mm": result["annual_rainfall_10yr_avg"],
                "kharif_tmax":        round(sum(kharif_tmax_all) / len(kharif_tmax_all), 1) if kharif_tmax_all else None,
                "rabi_tmin":          round(sum(rabi_tmin_all)   / len(rabi_tmin_all),   1) if rabi_tmin_all   else None,
            }
        except Exception:
            result["annual_rainfall_percentile"] = None
            result["annual_rainfall_10yr_avg"]   = None
            result["years_analysed"]             = None

        _weather_cache[dist_code] = {"data": result, "ts": time.time()}
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": f"Weather fetch failed: {str(e)}"}), 502

_forecast_cache = {}
FORECAST_CACHE_TTL = 21600  # 6 hours

@crops_bp.route("/api/districts/<int:dist_code>/weather/forecast", methods=["GET"])
def district_weather_forecast(dist_code):
    """16-day forward forecast for a district via Open-Meteo forecast API."""
    cached = _forecast_cache.get(dist_code)
    if cached and time.time() - cached["ts"] < FORECAST_CACHE_TTL:
        return jsonify({**cached["data"], "cached": True})

    coords = _load_coords()
    entry  = coords.get(str(dist_code))
    if not entry:
        return jsonify({"error": "Coordinates not available for this district"}), 404

    lat, lon = entry["lat"], entry["lon"]

    try:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude":      lat,
            "longitude":     lon,
            "daily":         "temperature_2m_max,temperature_2m_min,precipitation_sum",
            "timezone":      "Asia/Kolkata",
            "forecast_days": 16,
        }
        resp = http_requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        d = resp.json().get("daily", {})

        dates  = d.get("time", [])
        tmax   = [v for v in d.get("temperature_2m_max", []) if v is not None]
        tmin   = [v for v in d.get("temperature_2m_min", []) if v is not None]
        precip = d.get("precipitation_sum", [])

        n_days       = len(dates)
        total_precip = sum(v or 0 for v in precip)
        # Annualise: scale 16-day total to a full-year equivalent
        annual_rainfall_mm = round(total_precip * (365.0 / n_days), 1) if n_days > 0 else None

        training_climate = get_national_training_climate()
        result = {
            "annual_rainfall_mm": annual_rainfall_mm,
            "kharif_tmax":        round(sum(tmax) / len(tmax), 1) if tmax else None,
            "rabi_tmin":          round(sum(tmin) / len(tmin), 1) if tmin else None,
            "source":             f"Open-Meteo ({n_days}-day forecast, annualised)",
            "mode":               "forecast",
            "forecast_days":      n_days,
            "district":           entry.get("name"),
            "training_avg": {
                "annual_rainfall_mm": training_climate.get("ANNUAL RAINFALL (Millimeters)", {}).get("mean"),
                "kharif_tmax":        training_climate.get("KHARIF_TMAX", {}).get("mean"),
                "rabi_tmin":          training_climate.get("RABI_TMIN", {}).get("mean"),
            },
            "cached": False,
        }

        _forecast_cache[dist_code] = {"data": result, "ts": time.time()}
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": f"Forecast fetch failed: {str(e)}"}), 502


@crops_bp.route("/api/optimize-inputs", methods=["POST"])
def optimize_inputs_route():
    data      = request.get_json() or {}
    crop      = data.get("crop", "").lower()
    features  = data.get("features", {})
    dist_code = data.get("dist_code")
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404
    if dist_code is not None:
        try:    dist_code = int(dist_code)
        except: dist_code = None
    result = optimize_inputs_service(crop, features, dist_code)
    return jsonify(result)

@crops_bp.route("/api/crops/<crop>/backtest", methods=["GET"])
def crop_backtest(crop):
    crop = crop.lower()
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Unknown crop"}), 404
    dist_code = request.args.get("dist_code", type=int)
    if dist_code is None:
        return jsonify({"error": "dist_code query param required"}), 400
    backtest_path = Path(BASE_DIR) / "models" / f"{crop}_backtest.json"
    if not backtest_path.exists():
        return jsonify({"error": "Backtest data not available for this crop"}), 404
    with open(backtest_path) as f:
        data = json.load(f)
    rows = data.get(str(dist_code), data.get(dist_code))
    if rows is None:
        return jsonify({"error": "No backtest data for this district"}), 404
    return jsonify({"crop": crop, "dist_code": dist_code, "backtest": rows})