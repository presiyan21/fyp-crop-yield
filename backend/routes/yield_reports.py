from flask import Blueprint, jsonify, request, g
from middleware.auth import require_auth
import os
from supabase import create_client

yield_reports_bp = Blueprint("yield_reports", __name__)

def get_supabase():
    return create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@yield_reports_bp.route("/api/recommendations/<rec_id>/report-yield", methods=["POST"])
@require_auth
def report_yield(rec_id):
    """User submits their actual harvested yield for a past advisory."""
    data = request.get_json() or {}
    actual_yield = data.get("actual_yield")

    if actual_yield is None:
        return jsonify({"error": "actual_yield is required"}), 400
    try:
        actual_yield = float(actual_yield)
    except (TypeError, ValueError):
        return jsonify({"error": "actual_yield must be a number"}), 400
    if actual_yield <= 0:
        return jsonify({"error": "actual_yield must be positive"}), 400

    CROP_MAX_YIELD = {
        "rice": 10000, "wheat": 10000, "maize": 20000, "sugarcane": 80000,
        "pigeonpea": 5000, "groundnut": 8000, "pearl_millet": 8000,
        "chickpea": 5000, "sorghum": 8000, "cotton": 5000,
    }

    try:
        crop_key = (data.get("crop") or "").lower()
        max_allowed = CROP_MAX_YIELD.get(crop_key, 15000)
        if actual_yield > max_allowed:
            return jsonify({"error": f"Yield value {actual_yield} exceeds realistic maximum for {crop_key} ({max_allowed} Kg/ha). Please check your entry."}), 400
        sb = get_supabase()

        rec_res = sb.table("recommendations") \
            .select("id, user_id, crop, dist_code, predicted_yield, hist_median") \
            .eq("id", rec_id) \
            .execute()

        if not rec_res.data:
            return jsonify({"error": "Recommendation not found"}), 404

        rec = rec_res.data[0]
        if actual_yield > CROP_MAX_YIELD.get(rec.get("crop", ""), 15000):
            return jsonify({"error": f"Yield {actual_yield} Kg/ha exceeds realistic maximum for {rec.get('crop')} ({CROP_MAX_YIELD.get(rec.get('crop',''),15000):,} Kg/ha)"}), 400

        profile_res = sb.table("profiles").select("role").eq("id", g.user_id).execute()
        profile = profile_res.data[0] if profile_res.data else {}
        is_admin = profile.get("role") == "admin"

        if rec["user_id"] != g.user_id and not is_admin:
            return jsonify({"error": "Forbidden"}), 403

        existing = sb.table("yield_reports") \
            .select("id") \
            .eq("recommendation_id", rec_id) \
            .execute()

        if existing.data:
            return jsonify({"error": "Yield already reported for this advisory"}), 409

        insert_res = sb.table("yield_reports").insert({
            "recommendation_id": rec_id,
            "user_id": g.user_id,
            "actual_yield": actual_yield,
            "crop": rec.get("crop"),
            "dist_code": rec.get("dist_code"),
        }).execute()

        if not insert_res.data:
            return jsonify({"error": "Failed to save report"}), 500

        predicted = rec.get("predicted_yield")
        error_pct = round(((actual_yield - predicted) / predicted) * 100, 1) if predicted else None

        from services.model_service import get_hist_q25_for_district
        hist_q25  = get_hist_q25_for_district(rec.get("crop"), rec.get("dist_code"))
        hist_med  = rec.get("hist_median")
        actual_level = None
        if hist_med is not None and hist_q25 is not None:
            if actual_yield < hist_q25:     actual_level = "red"
            elif actual_yield < hist_med:   actual_level = "amber"
            else:                           actual_level = "green"

        return jsonify({
            "success":         True,
            "report":          insert_res.data[0],
            "predicted_yield": predicted,
            "actual_yield":    actual_yield,
            "error_pct":       error_pct,
            "actual_level":    actual_level,
        }), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@yield_reports_bp.route("/api/yield-reports", methods=["GET"])
@require_auth
def get_yield_reports():
    """Admin: fetch all yield reports joined with recommendation data for drift monitoring."""
    try:
        sb = get_supabase()

        profile_res = sb.table("profiles").select("role").eq("id", g.user_id).execute()
        profile = profile_res.data[0] if profile_res.data else {}
        if profile.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403

        reports_res = sb.table("yield_reports") \
            .select("id, recommendation_id, user_id, actual_yield, reported_at, crop, dist_code") \
            .order("reported_at", desc=True) \
            .execute()

        reports = reports_res.data or []

        if not reports:
            return jsonify({"reports": [], "summary": {}}), 200

        from services.model_service import get_hist_q25_for_district
        rec_ids = list({r["recommendation_id"] for r in reports if r["recommendation_id"]})
        rec_res = sb.table("recommendations") \
            .select("id, predicted_yield, district_name, level, hist_median, inputs, season_score") \
            .in_("id", rec_ids) \
            .execute()

        rec_map = {r["id"]: r for r in (rec_res.data or [])}

        enriched = []
        for r in reports:
            rec = rec_map.get(r["recommendation_id"], {})
            predicted = rec.get("predicted_yield")
            actual = r["actual_yield"]
            error_pct = round(((actual - predicted) / predicted) * 100, 1) if predicted else None
            abs_error = round(abs(actual - predicted), 1) if predicted else None
            hist_median = rec.get("hist_median")
            hist_q25 = get_hist_q25_for_district(r.get("crop"), r.get("dist_code"))

            # Classify actual yield using same thresholds as advisory engine
            actual_level = None
            if hist_median is not None and hist_q25 is not None:
                if actual < hist_q25:
                    actual_level = "red"
                elif actual < hist_median:
                    actual_level = "amber"
                else:
                    actual_level = "green"

            enriched.append({
                **r,
                "predicted_yield": predicted,
                "district_name":   rec.get("district_name"),
                "advisory_level":  rec.get("level"),
                "actual_level":    actual_level,
                "hist_median":     hist_median,
                "hist_q25":        hist_q25,
                "error_pct":       error_pct,
                "abs_error":       abs_error,
                "season_score":    rec.get("season_score"),
                # Why: errors >35% exceed district-level model capacity —
                # consistent with extreme weather events not in training data
                "is_shock":        abs(error_pct) > 35 if error_pct is not None else False,
            })

        from collections import defaultdict
        crop_stats = defaultdict(lambda: {"count": 0, "total_abs_error": 0.0, "errors": [], "season_scores": []})
        for r in enriched:
            if r["abs_error"] is not None:
                c = r["crop"]
                crop_stats[c]["count"] += 1
                crop_stats[c]["total_abs_error"] += r["abs_error"]
                crop_stats[c]["errors"].append(r["error_pct"])
                if r.get("season_score") is not None:
                    crop_stats[c]["season_scores"].append(r["season_score"])

        summary = {}
        for crop, s in crop_stats.items():
            errs   = s["errors"]
            scores = s["season_scores"]
            summary[crop] = {
                "count":            s["count"],
                "mae":              round(s["total_abs_error"] / s["count"], 1),
                "avg_err_pct":      round(sum(errs) / len(errs), 1),
                "overestimates":    sum(1 for e in errs if e < 0),
                "underestimates":   sum(1 for e in errs if e > 0),
                "avg_season_score": round(sum(scores) / len(scores)) if scores else None,
            }

        # CUSUM drift detection per crop
        from services.model_service import compute_cusum
        cusum_by_crop = {}
        crop_errors = {}
        for r in enriched:
            if r["predicted_yield"] is not None and r["actual_yield"] is not None:
                crop = r["crop"]
                error_signed = r["actual_yield"] - r["predicted_yield"]
                crop_errors.setdefault(crop, []).append(error_signed)
        for crop, errs in crop_errors.items():
            cusum_by_crop[crop] = compute_cusum(errs)

        from services.model_service import compute_adf_stationarity
        adf_by_crop = {}
        for crop, errs in crop_errors.items():
            if len(errs) >= 5:
                adf_by_crop[crop] = compute_adf_stationarity(errs)

        return jsonify({"reports": enriched, "summary": summary,
                        "cusum": cusum_by_crop, "adf": adf_by_crop})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
