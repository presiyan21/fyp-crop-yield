from flask import Blueprint, request, jsonify, g
from middleware.auth import require_auth
from services.model_service import DEFAULT_THRESHOLDS
from datetime import datetime, timezone
import os
from supabase import create_client

settings_bp = Blueprint("settings", __name__)

# Whitelist prevents unknown key injection
THRESHOLD_KEYS = frozenset(DEFAULT_THRESHOLDS.keys())


def get_supabase():
    return create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@settings_bp.route("/api/settings", methods=["GET"])
@require_auth
def get_settings():
    """Return the user's thresholds, falling back to system defaults."""
    try:
        sb  = get_supabase()
        res = sb.table("user_thresholds").select("*").eq("user_id", g.user_id).execute()
        if res.data and len(res.data) > 0:
            row = res.data[0]
            thresholds = {k: row[k] for k in THRESHOLD_KEYS if k in row}
            crop_overrides = row.get("crop_overrides") or {}
            return jsonify({"thresholds": thresholds, "is_custom": True, "crop_overrides": crop_overrides})
    except Exception:
        pass  # no row found is expected for new users

    return jsonify({"thresholds": DEFAULT_THRESHOLDS, "is_custom": False})


@settings_bp.route("/api/settings", methods=["PUT"])
@require_auth
def update_settings():
    """Upsert user thresholds. Unknown keys are silently ignored."""
    data = request.get_json() or {}

    payload = {}
    for key in THRESHOLD_KEYS:
        if key in data:
            try:
                payload[key] = float(data[key])
            except (TypeError, ValueError):
                return jsonify({"error": f"Invalid value for '{key}'"}), 400

    if "crop_overrides" in data:
        co = data["crop_overrides"]
        if isinstance(co, dict):
            validated_co = {}
            OVERRIDE_FIELDS = ("irrigation_min", "npk_min", "rainfall_dev_low", "rainfall_dev_high", "heat_stress_max")
            for crop_key, overrides in co.items():
                if not isinstance(overrides, dict):
                    continue
                validated_overrides = {}
                for field in OVERRIDE_FIELDS:
                    if field in overrides:
                        try:
                            validated_overrides[field] = float(overrides[field])
                        except (TypeError, ValueError):
                            pass
                if validated_overrides:
                    validated_co[crop_key] = validated_overrides
            payload["crop_overrides"] = validated_co

    if not payload:
        return jsonify({"error": "No valid threshold fields provided"}), 400

    try:
        sb = get_supabase()
        sb.table("user_thresholds").upsert({
            "user_id":    g.user_id,
            **payload,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="user_id").execute()
        return jsonify({"success": True, "thresholds": payload})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@settings_bp.route("/api/settings", methods=["DELETE"])
@require_auth
def reset_settings():
    """Delete user's custom thresholds, reverting to system defaults."""
    try:
        sb = get_supabase()
        sb.table("user_thresholds").delete().eq("user_id", g.user_id).execute()
        return jsonify({"success": True, "thresholds": DEFAULT_THRESHOLDS})
    except Exception as e:
        return jsonify({"error": str(e)}), 500