from flask import Blueprint, request, jsonify, g
from services.model_service import generate_advisory, DEFAULT_THRESHOLDS, compute_season_conditions
from config import SUPPORTED_CROPS
from middleware.auth import require_auth
from datetime import datetime, timezone
import os, json
from supabase import create_client

recommend_bp = Blueprint("recommend", __name__)

_DISTRICT_NAMES = {}
try:
    _dn_path = os.path.join(os.path.dirname(__file__), "..", "models", "district_names.json")
    with open(_dn_path) as _f:
        _DISTRICT_NAMES = json.load(_f)
except Exception as _e:
    print(f"[WARN] Could not load district_names.json: {_e}")

def _resolve_district_name(dist_code):
    """Return 'Name, State' string for a dist_code, or None."""
    if not dist_code:
        return None
    entry = _DISTRICT_NAMES.get(str(dist_code)) or _DISTRICT_NAMES.get(int(dist_code) if str(dist_code).isdigit() else dist_code)
    if not entry:
        return None
    if isinstance(entry, dict):
        name  = entry.get("name") or entry.get("district") or ""
        state = entry.get("state") or ""
        return f"{name}, {state}".strip(", ") or None
    return str(entry) or None


def get_supabase():
    return create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


def _fetch_user_thresholds(user_id):
    try:
        sb  = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
        res = sb.table("user_thresholds").select("*").eq("user_id", user_id).execute()
        return res.data[0] if res.data and len(res.data) > 0 else None
    except Exception:
        return None


@recommend_bp.route("/api/recommend", methods=["POST"])
@require_auth
def get_recommendation():
    data      = request.get_json()
    crop      = data.get("crop", "").lower()
    features  = data.get("features", {})
    dist_code = data.get("dist_code")

    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": f"Unsupported crop. Choose from: {SUPPORTED_CROPS}"}), 400

    try:
        row            = _fetch_user_thresholds(g.user_id)
        crop_overrides = (row or {}).get("crop_overrides") or {}
        advisory       = generate_advisory(crop, features, dist_code,
                                           thresholds=row,
                                           crop_overrides=crop_overrides)

        # Reconstruct effective thresholds for audit trail (mirrors override chain in generate_advisory)
        effective_t = {**DEFAULT_THRESHOLDS}
        if row:
            for _k in ("irrigation_min", "npk_min", "rainfall_dev_low", "rainfall_dev_high", "heat_stress_max"):
                if row.get(_k) is not None:
                    effective_t[_k] = row[_k]
        _co_crop = crop_overrides.get(crop) or {}
        if "irrigation_min" in _co_crop:
            effective_t["irrigation_min"] = float(_co_crop["irrigation_min"])
        if "npk_min" in _co_crop:
            effective_t["npk_min"] = float(_co_crop["npk_min"])
        if "rainfall_dev_low" in _co_crop:
            effective_t["rainfall_dev_low"] = float(_co_crop["rainfall_dev_low"])
        if "rainfall_dev_high" in _co_crop:
            effective_t["rainfall_dev_high"] = float(_co_crop["rainfall_dev_high"])
        if "heat_stress_max" in _co_crop:
            effective_t["heat_stress_max"] = float(_co_crop["heat_stress_max"])

        recommendation_id = None
        district_name     = _resolve_district_name(dist_code)
        try:
            sb     = get_supabase()
            season_score = None
            try:
                sc = compute_season_conditions(crop, features)
                score_map = {"favourable": 100, "mixed": 50, "challenging": 0}
                season_score = score_map.get(sc.get("overall"))
            except Exception:
                pass

            result = sb.table("recommendations").insert({
                "user_id":         g.user_id,
                "crop":            advisory["crop"],
                "inputs":          features,
                "level":           advisory["level"],
                "predicted_yield": advisory["predicted_yield"],
                "hist_median":     advisory["hist_median"],
                "actions":         advisory["actions"],
                "status":          "pending",
                "dist_code":       dist_code,
                "district_name":   district_name,
                "season_score":        season_score,
                "applied_thresholds":  effective_t,
            }).execute()
            if result.data:
                recommendation_id = result.data[0]["id"]
        except Exception as db_err:
            print(f"[WARN] DB save failed: {db_err}")

        return jsonify({
            **advisory,
            "recommendation_id": recommendation_id,
            "dist_code":         dist_code,
            "district_name":     district_name,
            "inputs":            features,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@recommend_bp.route("/api/recommendations/<rec_id>/accept", methods=["PATCH"])
@require_auth
def accept_recommendation(rec_id):
    try:
        sb     = get_supabase()
        result = (
            sb.table("recommendations")
            .update({
                "status":      "accepted",
                "accepted_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", rec_id)
            .eq("user_id", g.user_id)
            .execute()
        )
        if not result.data:
            return jsonify({"error": "Not found or not yours"}), 404
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
