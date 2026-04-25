from flask import Blueprint, jsonify, g
from middleware.auth import require_auth
import os
from supabase import create_client

history_bp = Blueprint("history", __name__)

def get_supabase():
    return create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

@history_bp.route("/api/history", methods=["GET"])
@require_auth
def get_history():
    try:
        sb = get_supabase()
        profile_res = sb.table("profiles").select("role").eq("id", g.user_id).execute()
        profile = profile_res.data[0] if profile_res.data else None
        is_admin = profile is not None and profile.get("role") == "admin"

        query = (
            sb.table("recommendations")
            .select("id, user_id, crop, level, predicted_yield, hist_median, actions, status, accepted_at, created_at, dist_code, district_name, season_score, inputs, applied_thresholds")
            .order("created_at", desc=True)
            .limit(200)
        )

        if not is_admin:
            query = query.eq("user_id", g.user_id)

        result = query.execute()
        recs = result.data or []

        # Join yield reports so the frontend can display classification verdicts
        if recs:
            try:
                rec_ids = [r["id"] for r in recs]
                yr_res = sb.table("yield_reports") \
                    .select("recommendation_id, actual_yield, crop, dist_code") \
                    .in_("recommendation_id", rec_ids) \
                    .execute()
                from services.model_service import get_hist_q25_for_district
                yield_map = {}
                for yr in (yr_res.data or []):
                    rid    = yr["recommendation_id"]
                    actual = yr["actual_yield"]
                    rec_row     = next((r for r in recs if r["id"] == rid), {})
                    hist_median = rec_row.get("hist_median")
                    dist_code   = yr.get("dist_code") or rec_row.get("dist_code")
                    hist_q25    = get_hist_q25_for_district(yr.get("crop"), dist_code)
                    actual_level = None
                    if hist_median is not None and hist_q25 is not None:
                        if actual < hist_q25:      actual_level = "red"
                        elif actual < hist_median: actual_level = "amber"
                        else:                      actual_level = "green"
                    yield_map[rid] = {
                        "actual_yield":  actual,
                        "actual_level":  actual_level,
                        "hist_q25":      hist_q25,
                    }
                recs = [{**r, **yield_map.get(r["id"], {})} for r in recs]
            except Exception:
                pass  # yield join is best-effort; don't break history page on error

        return jsonify({"recommendations": recs, "is_admin": is_admin})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@history_bp.route("/api/history/<rec_id>", methods=["DELETE"])
@require_auth
def delete_recommendation(rec_id):
    try:
        sb = get_supabase()
        check = (
            sb.table("recommendations")
            .select("id")
            .eq("id", rec_id)
            .eq("user_id", g.user_id)
            .execute()
        )
        if not check.data:
            return jsonify({"error": "Not found"}), 404
        sb.table("yield_reports").delete().eq("recommendation_id", rec_id).execute()
        sb.table("recommendations").delete().eq("id", rec_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500