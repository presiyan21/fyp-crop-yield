"""
Populate the demo database: recommendations, yield reports, and user thresholds.
Run from backend/; no Flask server required.
"""
import os, json, uuid, random
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase   = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
ADMIN_UID  = "29661629-597d-4a9f-bc4d-b6a562bdb6a0"
OLD_UID    = "9409a9ea-ef27-46b3-b241-a620fbdd995c"
MODELS_DIR = Path(__file__).parent / "models"

SUPPORTED_CROPS = [
    "rice","wheat","maize","sorghum","pearl_millet",
    "chickpea","pigeonpea","groundnut","cotton","sugarcane",
]

MSP = {
    "rice":2300,"wheat":2275,"maize":2090,"sorghum":3371,
    "pearl_millet":2500,"chickpea":5440,"pigeonpea":7000,
    "groundnut":6377,"cotton":7121,"sugarcane":340,
}

DEFAULT_THRESHOLDS = {
    "irrigation_min":0.3,"npk_min":50.0,
    "rainfall_dev_low":-20.0,"rainfall_dev_high":40.0,"heat_stress_max":2.0,
}

# Load artefacts
hist_stats, district_names = {}, {}
for crop in SUPPORTED_CROPS:
    p = MODELS_DIR / f"{crop}_hist_stats.csv"
    if p.exists():
        hist_stats[crop] = pd.read_csv(p)
names_path = MODELS_DIR / "district_names.json"
if names_path.exists():
    with open(names_path) as f:
        district_names = {int(k): v for k, v in json.load(f).items()}

def pick_district(crop):
    stats = hist_stats.get(crop)
    if stats is None or stats.empty:
        return None, "Unknown", 0, 0, 0
    s = stats.sort_values("hist_median")
    row = s.iloc[len(s) // 2]
    code = int(row["Dist Code"])
    info = district_names.get(code, {})
    name = f"{info.get('name','Unknown')}, {info.get('state','')}"
    return code, name, float(row["hist_median"]), float(row["hist_q25"]), float(row["hist_q75"])

def ts(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()

def make_inputs(median):
    return {
        "YIELD_LAG_1":                   round(median * random.uniform(0.90, 1.10), 1),
        "IRRIGATION_RATIO":              round(random.uniform(0.30, 0.75), 2),
        "NPK_TOTAL_KG_PER_HA":           round(random.uniform(55, 145), 1),
        "ANNUAL RAINFALL (Millimeters)": round(random.uniform(650, 1150), 1),
        "KHARIF_TMAX":                   round(random.uniform(29, 37), 1),
        "RABI_TMIN":                     round(random.uniform(11, 21), 1),
    }

# 6 scenarios per crop covering all 3 advisory levels + 2 shocks
# (name, level, pred_mult, actual_mult, season_score, created_days_ago)
SCENARIOS = [
    ("green-correct",     "green", 1.14, 1.10, 86,  178),
    ("amber-overperform", "amber", 0.87, 1.06, 61,  148),
    ("red-correct",       "red",   0.63, 0.66, 37,  118),
    ("green-miss",        "green", 1.20, 0.80, 71,   88),
    ("shock-over",        "amber", 0.81, 1.48, 54,   55),  # error ~56% — shock
    ("shock-under",       "green", 1.11, 0.59, 68,   22),  # error ~47% — shock
]

CROP_ACTIONS = {
    "green": ["Conditions look favourable — maintain current agronomic practices"],
    "amber": ["NPK application is below the recommended threshold — consider top-dressing",
              "Monitor soil moisture over the coming weeks"],
    "red":   ["Irrigation coverage is critically low — supplement water supply immediately",
              "Consider applying additional fertilizer to improve yield potential"],
}

for uid_label, uid in [("examiner", ADMIN_UID), ("old dev", OLD_UID)]:
    print(f"Clearing {uid_label} data...")
    try:
        existing = supabase.table("recommendations").select("id").eq("user_id", uid).execute()
        if existing.data:
            ids = [r["id"] for r in existing.data]
            supabase.table("yield_reports").delete().in_("recommendation_id", ids).execute()
            supabase.table("recommendations").delete().eq("user_id", uid).execute()
            print(f"  Removed {len(ids)} records")
        else:
            print(f"  Nothing to clear")
        supabase.table("user_thresholds").delete().eq("user_id", uid).execute()
    except Exception as e:
        print(f"  Clear skipped: {e}")

total, shocks = 0, 0
for crop_idx, crop in enumerate(SUPPORTED_CROPS):
    dist_code, dist_name, median, q25, q75 = pick_district(crop)
    if dist_code is None:
        print(f"  SKIP {crop} — no hist_stats")
        continue

    print(f"\n{crop} | dist {dist_code} | median {median:.0f} kg/ha")

    for sc_name, level, pred_m, actual_m, sscore, days_ago in SCENARIOS:
        pred_yield   = round(median * pred_m,   1)
        actual_yield = round(median * actual_m, 1)
        stagger      = crop_idx          # slightly stagger per-crop so weekly chart is spread

        rec = {
            "user_id":            ADMIN_UID,
            "crop":               crop,
            "inputs":             make_inputs(median),
            "level":              level,
            "predicted_yield":    pred_yield,
            "hist_median":        round(median, 1),
            "actions":            CROP_ACTIONS[level],
            "status":             "accepted",
            "accepted_at":        ts(days_ago + stagger - 1),
            "dist_code":          dist_code,
            "district_name":      dist_name,
            "season_score":       sscore,
            "applied_thresholds": DEFAULT_THRESHOLDS,
            "created_at":         ts(days_ago + stagger),
        }
        try:
            res    = supabase.table("recommendations").insert(rec).execute()
            rec_id = res.data[0]["id"]
        except Exception as e:
            print(f"  WARN rec insert [{sc_name}]: {e}")
            continue

        yr = {
            "recommendation_id": rec_id,
            "user_id":           ADMIN_UID,
            "actual_yield":      actual_yield,
            "crop":              crop,
            "dist_code":         dist_code,
            "reported_at":       ts(max(3, days_ago + stagger - 28)),  # ~28 days after advisory
        }
        try:
            supabase.table("yield_reports").insert(yr).execute()
            err_pct = abs(actual_yield - pred_yield) / max(pred_yield, 1) * 100
            shock   = " *** SHOCK" if err_pct > 35 else ""
            print(f"  + {sc_name:22s}  pred={pred_yield:6.0f}  actual={actual_yield:6.0f}  err={err_pct:4.0f}%{shock}")
            total += 1
            if err_pct > 35:
                shocks += 1
        except Exception as e:
            print(f"  WARN yield insert [{sc_name}]: {e}")

print("\nSeeding user thresholds with crop overrides...")
try:
    supabase.table("user_thresholds").upsert({
        "user_id":           ADMIN_UID,
        "irrigation_min":    0.35,
        "npk_min":           60.0,
        "rainfall_dev_low":  -15.0,
        "rainfall_dev_high": 35.0,
        "heat_stress_max":   1.8,
        "crop_overrides": {
            "rice":      {"irrigation_min": 0.60, "npk_min": 80},
            "sugarcane": {"irrigation_min": 0.70, "npk_min": 120, "heat_stress_max": 2.0},
            "chickpea":  {"npk_min": 25, "rainfall_dev_high": 25},
        },
    }).execute()
    print("  Thresholds + 3 crop overrides inserted")
except Exception as e:
    print(f"  Threshold seed skipped: {e}")

print(f"\nDone — {total} yield reports inserted ({shocks} shocks across {len(SUPPORTED_CROPS)} crops)")
print("Refresh the Admin page to see populated charts, confusion matrix, and CUSUM.")
