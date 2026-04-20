import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchCrops, getRecommendation, fetchCropSchema,
  fetchModelInfo, fetchCropDistricts, fetchDistrictCropSummary, fetchDistrictWeather, fetchDistrictWeatherForecast,
  fetchSeasonConditions,
} from "../lib/api";
import AdvisoryCard from "../components/AdvisoryCard";
import ScenarioComparison from "../components/ScenarioComparison";
import { Loader2, GitCompare, MapPin, TrendingUp, AlertCircle, BarChart2 } from "lucide-react";
import CropRanker from "../components/CropRanker";
import RiskCompare from "../components/RiskCompare";

const DEFAULTS = {
  YIELD_LAG_1: 1500, YIELD_LAG_3: 1400, YEAR_TREND: 45, DECADE: 2010,
  IRRIGATION_RATIO: 0.4, NPK_TOTAL_KG_PER_HA: 80, RAINFALL_DEV_PCT: -5,
  HEAT_STRESS: 0.5, FERT_IRR_INTERACTION: 32, N_SHARE: 0.6,
  "ANNUAL RAINFALL (Millimeters)": 1100, KHARIF_RAIN_MM: 800, RABI_RAIN_MM: 300,
  "CANALS AREA (1000 ha)": 25, "TUBE WELLS AREA (1000 ha)": 35,
  "TOTAL WELLS AREA (1000 ha)": 45, "NET AREA (1000 ha)": 100,
  "GROSS AREA (1000 ha)": 130, "NET CROPPED AREA (1000 ha)": 220,
  "GROSS CROPPED AREA (1000 ha)": 280, KHARIF_TMAX: 33, KHARIF_TMIN: 25,
  RABI_TMAX: 27, RABI_TMIN: 11, ANNUAL_TMAX: 31, ANNUAL_TMIN: 20,
  DIURNAL_TEMP_RANGE: 11, N_KG_PER_HA: 50, P_KG_PER_HA: 20, K_KG_PER_HA: 10,
  FERT_KHARIF_TONS: 6000, FERT_RABI_TONS: 4000, GROWING_PERIOD_DAYS: 200,
  "ANNUAL NORMAL RAINFALL (Millimeters)": 1150, FERT_DATA_AVAILABLE: 1,
  RAINFALL_DEV_MM: -50, CANAL_WELL_RATIO: 0.36, WATER_INTENSITY: 1.1,
  CROPPING_INTENSITY: 130, NET_CROP_RATIO: 0.78, COLD_STRESS: 0,
  KHARIF_TEMP_RANGE: 8, RABI_TEMP_RANGE: 16, PRICE_TREND_3YR: 800,
  SOIL_INCEPTISOLS: 1, SOIL_LOAMY: 0, SOIL_ORTHIDS: 0, SOIL_OTHER: 0,
  SOIL_PSSAMENTS: 0, SOIL_SANDY: 0, SOIL_UDALFS: 0, "SOIL_UDOLLS/UDALFS": 0,
  "SOIL_UDUPTS/UDALFS": 0, "SOIL_USTALF/USTOLLS": 0, "SOIL_USTALFS-OCHREPTS": 0,
  SOIL_VERTIC: 0, SOIL_VERTISOLS: 0,
};

const USER_FIELDS = [
  { key: "YIELD_LAG_1",                   label: "Last year's yield (Kg/ha)",  step: 50   },
  { key: "IRRIGATION_RATIO",              label: "Irrigation ratio (0–1)",     step: 0.05 },
  { key: "NPK_TOTAL_KG_PER_HA",           label: "NPK fertilizer (Kg/ha)",     step: 5    },
  { key: "ANNUAL RAINFALL (Millimeters)", label: "Annual rainfall (mm)",       step: 50   },
  { key: "KHARIF_TMAX",                   label: "Kharif max temp (C)",       step: 0.5  },
  { key: "RABI_TMIN",                     label: "Rabi min temp (C)",         step: 0.5  },
];

// Maps user-facing field keys to weather data keys + deviation thresholds
const WEATHER_OOD_META = {
  "ANNUAL RAINFALL (Millimeters)": { trainKey: "annual_rainfall_mm", isTemp: false },
  "KHARIF_TMAX":                   { trainKey: "kharif_tmax",        isTemp: true  },
  "RABI_TMIN":                     { trainKey: "rabi_tmin",          isTemp: true  },
};

function buildFieldImportance(shapTop10) {
  if (!shapTop10 || Object.keys(shapTop10).length === 0) return {};
  const sorted = Object.entries(shapTop10).sort(([, a], [, b]) => b - a);
  const result = {};
  USER_FIELDS.forEach(({ key }) => {
    const idx = sorted.findIndex(([f]) => f === key);
    if (idx !== -1) result[key] = { rank: idx + 1, total: sorted.length };
  });
  return result;
}

function getFieldWarning(key, value) {
  const v = Number(value);
  if (key === "IRRIGATION_RATIO") {
    if (v > 1.0) return "Cannot exceed 1.0 (100% of crop area irrigated)";
    if (v < 0)   return "Cannot be negative";
  }
  if (key === "YIELD_LAG_1"         && v < 0)  return "Previous year's yield cannot be negative";
  if (key === "NPK_TOTAL_KG_PER_HA" && v < 0)  return "Fertilizer amount cannot be negative";
  if (key === "KHARIF_TMAX"         && v > 55) return "Unusually high — please verify (°C)";
  if (key === "RABI_TMIN"           && v < -5) return "Unusually low — please verify (°C)";
  return null;
}

// Crop-specific agronomic hints — informational only, never block submission
function getAgronomicHint(key, value, crop) {
  const v = Number(value);
  if (!crop || isNaN(v)) return null;

  if (key === "ANNUAL RAINFALL (Millimeters)") {
    if (crop === "rice" && v < 600)
      return "Rice is water-intensive — rainfall below 600 mm typically requires heavy supplemental irrigation to prevent crop failure.";
    if ((crop === "pearl_millet" || crop === "sorghum") && v > 1600)
      return (crop === "pearl_millet" ? "Pearl millet" : "Sorghum") + " is drought-adapted — rainfall above 1600 mm is unusually high and may indicate waterlogging risk for this crop.";
    if (crop === "wheat" && v > 1400)
      return "Wheat prefers drier Rabi conditions — rainfall above 1400 mm can promote fungal disease and lodging.";
    if (crop === "chickpea" && v > 900)
      return "Chickpea is a dry-season Rabi legume — rainfall above 900 mm is unusually high and increases fungal blight risk.";
    if (crop === "sugarcane" && v < 700)
      return "Sugarcane has very high water demand — annual rainfall below 700 mm requires intensive irrigation infrastructure.";
    if (crop === "cotton" && v > 1400)
      return "Excess rainfall during boll development reduces cotton fibre quality and increases disease pressure.";
  }

  if (key === "IRRIGATION_RATIO") {
    if (crop === "rice" && v < 0.35 && v >= 0)
      return "Rice (paddy) typically requires irrigation ratio >= 0.40 — low irrigation is a leading cause of yield loss for this water-intensive crop.";
    if (crop === "sugarcane" && v < 0.50 && v >= 0)
      return "Sugarcane has year-round high water demand — irrigation ratio below 0.50 is typically insufficient for this crop.";
    if ((crop === "pearl_millet" || crop === "sorghum") && v > 0.50)
      return (crop === "pearl_millet" ? "Pearl millet" : "Sorghum") + " is drought-adapted and typically rainfed — irrigation ratio above 0.50 is unusual and may be a data entry error.";
    if (crop === "chickpea" && v > 0.40)
      return "Chickpea is a low-water Rabi legume — irrigation ratio above 0.40 exceeds typical agronomic practice for this crop.";
  }

  if (key === "NPK_TOTAL_KG_PER_HA") {
    if (crop === "rice" && v < 40 && v >= 0)
      return "Rice typically requires 80-120 kg/ha NPK — values below 40 kg/ha suggest severe nutrient deficiency that will significantly limit yield.";
    if (crop === "sugarcane" && v < 80 && v >= 0)
      return "Sugarcane is highly nutrient-demanding (120+ kg/ha recommended) — NPK below 80 kg/ha is likely a yield-limiting constraint.";
    if ((crop === "chickpea" || crop === "pigeonpea") && v > 80)
      return (crop === "chickpea" ? "Chickpea" : "Pigeonpea") + " fixes atmospheric nitrogen — NPK above 80 kg/ha is unusually high for a legume and may indicate a data entry error.";
  }

  if (key === "KHARIF_TMAX") {
    if (crop === "rice" && v > 40)
      return "Kharif temperatures above 40 degrees C cause spikelet sterility in rice during flowering — significant yield penalty is expected.";
    if ((crop === "pearl_millet" || crop === "sorghum") && v < 25)
      return (crop === "pearl_millet" ? "Pearl millet" : "Sorghum") + " is heat-adapted — Kharif max temperatures below 25 degrees C are unusual for this crop.";
  }

  if (key === "RABI_TMIN") {
    if (crop === "wheat" && v > 12)
      return "Wheat requires winter cold for grain development — Rabi min temperatures above 12 degrees C reduce grain set and are associated with poor wheat seasons.";
    if (crop === "chickpea" && v > 15)
      return "Chickpea is a cool-season crop — Rabi min temperatures above 15 degrees C are unusually warm and can reduce pod set.";
  }

  return null;
}


function districtLabel(d) {
  if (d.name && d.state) {
    return `${d.name}, ${d.state} — median ${d.median.toLocaleString()} Kg/ha`;
  }
  return `District ${d.code} — median ${d.median.toLocaleString()} Kg/ha`;
}

function DistrictCropProfile({ summary, activeCrop, districtName, onCropSelect }) {
  if (!summary || summary.length === 0) return null;
  const maxMedian = summary[0].median;

  return (
    <div className="bg-white border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <BarChart2 size={15} className="text-emerald-600" />
        <h2 className="text-sm font-semibold text-slate-800">District Crop Profile</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Historical median yields in{" "}
        <span className="font-medium text-slate-600">{districtName}</span>
        {" "} 1966–2015 ICRISAT data  click a crop to switch
      </p>

      <div className="space-y-2">
        {summary.map((item, idx) => {
          const isActive  = item.crop === activeCrop;
          const barPct    = Math.round((item.median / maxMedian) * 100);
          const cropLabel = item.crop.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());

          return (
            <div
              key={item.crop}
              onClick={() => onCropSelect && onCropSelect(item.crop)}
              className={`rounded-lg px-3 py-2 transition-all cursor-pointer ${
                isActive
                  ? "bg-emerald-50 border border-emerald-200 ring-1 ring-emerald-200"
                  : "bg-gray-50/60 border border-transparent hover:bg-slate-50 hover:border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center
                                    justify-center flex-shrink-0 ${
                    idx === 0 ? "bg-amber-100 text-amber-700" :
                    idx === 1 ? "bg-slate-200 text-slate-600" :
                    idx === 2 ? "bg-orange-50 text-orange-600" :
                                "bg-gray-100 text-gray-400"
                  }`}>
                    {idx + 1}
                  </span>
                  <span className={`text-xs font-medium ${isActive ? "text-emerald-800" : "text-slate-700"}`}>
                    {cropLabel}
                  </span>
                  {isActive && (
                    <span className="text-[9px] font-semibold bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded-full">
                      selected
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  {item.median.toLocaleString()} Kg/ha
                </span>
              </div>

              <div className="h-1.5 bg-white rounded-full overflow-hidden border border-gray-100">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    isActive ? "bg-emerald-500" : "bg-slate-300"
                  }`}
                  style={{ width: `${barPct}%` }}
                />
              </div>

              {idx === 0 && (
                <p className="text-[9px] text-amber-600 mt-1">
                  ★ Highest-yielding crop in this district historically
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-300 mt-3 border-t border-gray-100 pt-2">
        Click any crop to switch selection  then run advisory to compare
      </p>
    </div>
  );
}

function CompactDistrictStrip({ summary, activeCrop, districtName, onCropSelect }) {
  if (!summary || summary.length === 0) return null;
  const activeRank = summary.findIndex(s => s.crop === activeCrop);

  return (
    <div className="bg-slate-50 border rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
          <BarChart2 size={12} className="text-slate-400" />
          {districtName} — all crops ranked
        </span>
        {activeRank >= 0 && (
          <span className="text-[10px] text-slate-500 font-medium">
            {activeCrop.replace(/_/g, " ")} ranks #{activeRank + 1} here
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {summary.map((item, idx) => {
          const isActive = item.crop === activeCrop;
          const label    = item.crop.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
          return (
            <button
              key={item.crop}
              onClick={() => onCropSelect(item.crop)}
              className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                isActive
                  ? "bg-emerald-100 border-emerald-300 text-emerald-800 font-semibold"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300"
              }`}
            >
              <span className="text-slate-400 mr-0.5">#{idx + 1}</span>
              {label}
              <span className="text-slate-400 ml-1">{(item.median / 1000).toFixed(1)}k</span>
            </button>
          );
        })}
      </div>
      <p className="text-[9px] text-slate-300 mt-2">Switch crop then run a new advisory to compare across crops</p>
    </div>
  );
}

const KHARIF_CROPS = new Set(["rice", "maize", "sorghum", "pearl_millet", "groundnut", "cotton"]);
const RABI_CROPS   = new Set(["wheat", "chickpea", "pigeonpea", "sugarcane"]);

function CropRotationPanel({ activeCrop, districtSummary, districtName, onCropSelect }) {
  if (!districtSummary || districtSummary.length === 0) return null;

  const isKharif  = KHARIF_CROPS.has(activeCrop);
  const isRabi    = RABI_CROPS.has(activeCrop);
  if (!isKharif && !isRabi) return null;

  const currentSeason   = isKharif ? "Kharif" : "Rabi";
  const nextSeason      = isKharif ? "Rabi"   : "Kharif";
  const nextSeasonSet   = isKharif ? RABI_CROPS : KHARIF_CROPS;

  const suggestions = districtSummary
    .filter(item => nextSeasonSet.has(item.crop))
    .sort((a, b) => b.median - a.median)
    .slice(0, 3);

  if (suggestions.length === 0) return null;


  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🔄</span>
        <h3 className="text-sm font-semibold text-slate-800">Crop Rotation Suggestion</h3>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
          {currentSeason} → {nextSeason}
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        After your {activeCrop.replace(/_/g, " ")} ({currentSeason}), these {nextSeason} crops have the
        strongest historical performance in{" "}
        <span className="font-medium text-slate-600">{districtName}</span>.
      </p>

      <div className="space-y-2">
        {suggestions.map((item, idx) => {
          const label    = item.crop.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
          const isTop    = idx === 0;
          return (
            <div
              key={item.crop}
              onClick={() => onCropSelect(item.crop)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-all border ${
                isTop
                  ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                  : "bg-slate-50 border-transparent hover:bg-slate-100"
              }`}
            >
              <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                idx === 0 ? "bg-emerald-200 text-emerald-800" :
                idx === 1 ? "bg-slate-200 text-slate-600" :
                            "bg-slate-100 text-slate-400"
              }`}>
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${isTop ? "text-emerald-800" : "text-slate-700"}`}>
                    {label}
                  </span>
                  {isTop && (
                    <span className="text-[9px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded-full font-semibold">
                      Best rotation
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  District median: {item.median.toLocaleString()} Kg/ha
                </div>
              </div>
              <span className="text-[10px] text-slate-400 shrink-0">
                Switch →
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-300 mt-3 border-t border-slate-100 pt-2">
        Based on 1966–2015 district historical medians  Click a crop to switch and run a new advisory
      </p>
    </div>
  );
}

const WEATHER_FIELD_META = {
  "ANNUAL RAINFALL (Millimeters)": { label: "Annual rainfall", unit: "mm",  key: "annual_rainfall_mm" },
  "KHARIF_TMAX":                   { label: "Kharif max temp", unit: "C",  key: "kharif_tmax" },
  "RABI_TMIN":                     { label: "Rabi min temp",   unit: "C",  key: "rabi_tmin"   },
};

function ClimateContextPanel({ weatherData }) {
  if (!weatherData?.training_avg) return null;

  const hasDistrict = weatherData.district_avg &&
    Object.values(weatherData.district_avg).some(v => v != null);

  // Prefer district baseline (10-yr local) over national training average
  const baseline    = hasDistrict ? weatherData.district_avg : weatherData.training_avg;
  const baselineLabel = hasDistrict
    ? `${weatherData.district} (${weatherData.years_analysed}-yr avg)`
    : "national mean  311 districts  1966–2005";

  const rows = Object.entries(WEATHER_FIELD_META).map(([, { label, unit, key }]) => {
    const current  = weatherData[key];
    const baseVal  = baseline[key];
    const trainAvg = weatherData.training_avg[key];
    if (current == null || baseVal == null) return null;

    const delta    = current - baseVal;
    const deltaPct = ((delta / baseVal) * 100).toFixed(1);
    const absD     = Math.abs(delta);

    const isTemp   = unit === "C";
    const severity = isTemp
      ? (absD >= 5 ? "high" : absD >= 2 ? "medium" : "low")
      : (Math.abs(deltaPct) >= 25 ? "high" : Math.abs(deltaPct) >= 10 ? "medium" : "low");

    const arrow  = delta > 0 ? "↑" : "↓";
    const colour = severity === "high"   ? { text: "text-red-600",    bg: "bg-red-50",    pill: "bg-red-100 text-red-700" }
                 : severity === "medium" ? { text: "text-amber-600",  bg: "bg-amber-50",  pill: "bg-amber-100 text-amber-700" }
                 :                        { text: "text-emerald-600", bg: "bg-emerald-50",pill: "bg-emerald-100 text-emerald-700" };

    // National deviation — show as secondary context when district baseline is active
    const nationalDelta = trainAvg != null ? current - trainAvg : null;
    const nationalNote  = hasDistrict && nationalDelta != null
      ? (isTemp
          ? `${nationalDelta >= 0 ? "+" : ""}${nationalDelta.toFixed(1)}C vs national avg`
          : `${nationalDelta >= 0 ? "+" : ""}${((nationalDelta / trainAvg) * 100).toFixed(0)}% vs national avg`)
      : null;

    return { label, unit, current, baseVal, delta, deltaPct, arrow, severity, colour, key, nationalNote };
  }).filter(Boolean);

  const hasHighSeverity = rows.some(r => r.severity === "high");
  const hasMedium       = rows.some(r => r.severity === "medium");

  return (
    <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <span className="text-sm">🌍</span>
        <span className="text-xs font-semibold text-slate-700">Current vs Climate Baseline</span>
        {hasDistrict && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
            District-specific
          </span>
        )}
        {hasHighSeverity && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
            Large shift detected
          </span>
        )}
        {!hasHighSeverity && hasMedium && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            Moderate shift
          </span>
        )}
        {!hasHighSeverity && !hasMedium && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            Near baseline
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map(r => (
          <div key={r.key} className={`px-3 py-2 ${r.colour.bg}`}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 w-28 shrink-0">{r.label}</span>
              <span className="text-xs font-mono font-semibold text-slate-800">
                {r.current} {r.unit}
              </span>
              <span className="text-[10px] text-slate-400 mx-1">vs</span>
              <span className="text-xs font-mono text-slate-500">
                {r.baseVal} {r.unit}
              </span>
              <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full ${r.colour.pill}`}>
                {r.arrow} {r.unit === "C"
                  ? `${Math.abs(r.delta).toFixed(1)}C`
                  : `${Math.abs(r.deltaPct)}%`}
              </span>
            </div>
            {r.nationalNote && (
              <p className="text-[10px] text-slate-400 mt-0.5 pl-0.5">{r.nationalNote}</p>
            )}
            {r.key === "annual_rainfall_mm" && weatherData.annual_rainfall_percentile != null && (
              <p className="text-[10px] text-slate-500 mt-1 pl-0.5">
                📊 {weatherData.annual_rainfall_percentile}th percentile vs past {weatherData.years_analysed} years (this district)
                {weatherData.annual_rainfall_percentile >= 75
                  ? " — unusually wet year"
                  : weatherData.annual_rainfall_percentile <= 25
                    ? " — unusually dry year"
                    : " — near-normal year"}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 bg-slate-50 border-t border-slate-100">
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Baseline: <span className="font-medium text-slate-500">{baselineLabel}</span>.
          {hasDistrict
            ? " District-specific 10-year historical average used where available — more locally accurate than the national mean."
            : " National mean used — select a district with available coordinates for a local baseline."}
          {hasHighSeverity && (
            <span className="text-red-500 font-medium"> High deviation — treat prediction with extra caution.</span>
          )}
        </p>
      </div>
    </div>
  );
}

const _WINDOWS = {
  rice:         { window: "Jun–Aug",     sowMonths: [5,6,7],    season: "Kharif", note: "transplanting" },
  wheat:        { window: "Oct–Nov",     sowMonths: [9,10],     season: "Rabi",   note: "sowing" },
  maize:        { window: "Jun–Jul",     sowMonths: [5,6],      season: "Kharif", note: "sowing" },
  sorghum:      { window: "Jun–Jul",     sowMonths: [5,6],      season: "Kharif", note: "sowing" },
  pearl_millet: { window: "Jun–Jul",     sowMonths: [5,6],      season: "Kharif", note: "sowing" },
  chickpea:     { window: "Oct–Nov",     sowMonths: [9,10],     season: "Rabi",   note: "sowing" },
  pigeonpea:    { window: "Jun–Jul",     sowMonths: [5,6],      season: "Kharif", note: "sowing" },
  groundnut:    { window: "Jun–Jul",     sowMonths: [5,6],      season: "Kharif", note: "sowing" },
  cotton:       { window: "May–Jun",     sowMonths: [4,5],      season: "Kharif", note: "sowing" },
  sugarcane:    { window: "Feb–Mar / Oct–Nov", sowMonths: [1,2,9,10], season: "Annual", note: "planting" },
};

function PlantingWindowBanner({ crop }) {
  const w = _WINDOWS[crop];
  if (!w) return null;
  const month = new Date().getMonth(); // 0=Jan
  const inWindow = w.sowMonths.includes(month);
  const monthsToNext = (() => {
    const upcoming = w.sowMonths.filter(m => m > month);
    if (upcoming.length > 0) return upcoming[0] - month;
    return (w.sowMonths[0] + 12) - month;
  })();
  const justPassed = !inWindow && w.sowMonths.some(m => month - m > 0 && month - m <= 2);
  const approaching = !inWindow && monthsToNext <= 2;

  const cfg = inWindow
    ? { bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500", label: "In planting window", textCol: "text-emerald-700" }
    : approaching
    ? { bg: "bg-amber-50",   border: "border-amber-200",   dot: "bg-amber-400",   label: `${monthsToNext} month${monthsToNext > 1 ? "s" : ""} away`, textCol: "text-amber-700" }
    : { bg: "bg-slate-50",   border: "border-slate-200",   dot: "bg-slate-300",   label: justPassed ? "Window just passed" : "Outside window", textCol: "text-slate-500" };

  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border mb-3 ${cfg.bg} ${cfg.border}`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className="text-[11px] text-slate-600">
        <span className="font-semibold">{w.season} {w.note}:</span> {w.window}
      </span>
      <span className={`ml-auto text-[10px] font-semibold ${cfg.textCol}`}>{cfg.label}</span>
    </div>
  );
}

function SeasonOutlookCard({ conditions, loading }) {
  if (loading) return (
    <div className="bg-white border rounded-xl p-4 animate-pulse flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-slate-200" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-slate-200 rounded w-1/2" />
        <div className="h-2 bg-slate-100 rounded w-3/4" />
      </div>
    </div>
  );
  if (!conditions) return null;

  const { overall, signals } = conditions;

  const overallCfg = {
    favourable:  { bg: "bg-emerald-50", border: "border-emerald-200", pill: "bg-emerald-100 text-emerald-700", text: "Favourable" },
    mixed:       { bg: "bg-amber-50",   border: "border-amber-200",   pill: "bg-amber-100 text-amber-700",     text: "Mixed"       },
    challenging: { bg: "bg-red-50",     border: "border-red-200",     pill: "bg-red-100 text-red-700",         text: "Challenging" },
  }[overall] ?? { bg: "bg-slate-50", border: "border-slate-200", pill: "bg-slate-100 text-slate-600", text: "—" };

  const dotCfg = {
    normal:      "bg-emerald-400",
    watch:       "bg-amber-400",
    challenging: "bg-red-400",
  };
  const textCfg = {
    normal:      "text-slate-500",
    watch:       "text-amber-700",
    challenging: "text-red-700 font-medium",
  };

  return (
    <div className={`rounded-xl border p-4 ${overallCfg.bg} ${overallCfg.border}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🌱</span>
          <span className="text-xs font-semibold text-slate-800">Season Outlook</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${overallCfg.pill}`}>
          {overallCfg.text}
        </span>
      </div>

      <div className="space-y-1.5">
        {signals.map(s => (
          <div key={s.key} className="flex items-center gap-2.5">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCfg[s.status]}`} />
            <span className="text-[11px] text-slate-600 w-24 flex-shrink-0">{s.label}</span>
            <span className={`text-[11px] ${textCfg[s.status]}`}>{s.diff_str}</span>
          </div>
        ))}
      </div>

      <p className="text-[9px] text-slate-400 mt-1.5">
        Compared to this crop's 1966–2005 training distribution
      </p>
    </div>
  );
}

const CROP_CALENDAR_DATA = {
  rice:         [null,null,null,null,null,"sow","sow","sow","grow","grow","harvest","harvest"],
  wheat:        ["grow","grow","harvest","harvest",null,null,null,null,null,"sow","sow","grow"],
  maize:        [null,null,null,null,null,"sow","sow","grow","grow","harvest",null,null],
  sorghum:      [null,null,null,null,null,"sow","sow","grow","grow","harvest",null,null],
  pearl_millet: [null,null,null,null,null,"sow","sow","grow","grow","harvest",null,null],
  chickpea:     ["harvest","harvest",null,null,null,null,null,null,null,"sow","sow","grow"],
  pigeonpea:    ["harvest","harvest",null,null,null,"sow","sow","grow","grow","grow","grow","grow"],
  groundnut:    [null,null,null,null,null,"sow","sow","grow","grow","harvest","harvest",null],
  cotton:       [null,null,null,null,"sow","sow","grow","grow","grow","grow","grow","harvest"],
  sugarcane:    ["grow","sow","sow","grow","grow","grow","grow","grow","grow","sow","sow","harvest"],
};
const CAL_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CAL_CROP_ORDER = ["rice","wheat","maize","sorghum","pearl_millet","chickpea","pigeonpea","groundnut","cotton","sugarcane"];

function PlantingCalendar({ activeCrop, onClose }) {
  const currentMonth = new Date().getMonth();

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              📅 Crop Planting Calendar
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Indian agricultural seasons  Kharif (Jun–Oct) and Rabi (Oct–Mar) 
              currently selected crop highlighted
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-lg
                       transition text-xl leading-none font-light"
          >
            
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-5 py-2.5 bg-slate-50 border-b text-[11px]">
          {[
            { cls: "bg-emerald-500",                        label: "Sowing window"   },
            { cls: "bg-emerald-100 border border-emerald-200", label: "Growing season"  },
            { cls: "bg-amber-300",                          label: "Harvest period"  },
            { cls: "bg-slate-100",                          label: "Off-season"      },
          ].map(({ cls, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`inline-block w-3 h-3 rounded-sm ${cls}`} />
              <span className="text-slate-600">{label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5 ml-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-white ring-2 ring-blue-400" />
            <span className="text-slate-600">Current month ({CAL_MONTHS[currentMonth]})</span>
          </span>
        </div>

        <div className="p-4 overflow-x-auto">
          <table
            className="w-full border-separate border-spacing-y-0.5"
            style={{ minWidth: "560px" }}
          >
            <thead>
              <tr>
                <th className="text-left text-[10px] font-semibold text-slate-400 uppercase
                               tracking-wide pb-2 w-28 pr-2">
                  Crop
                </th>
                {CAL_MONTHS.map((m, i) => (
                  <th key={m} className="pb-2 w-8">
                    <div className={`text-[11px] font-semibold text-center ${
                      i === currentMonth ? "text-blue-600" : "text-slate-400"
                    }`}>
                      {m}
                    </div>
                    {i === currentMonth && (
                      <div className="h-0.5 w-full bg-blue-400 rounded-full mt-0.5" />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAL_CROP_ORDER.map(cropKey => {
                const isActive = cropKey === activeCrop;
                const label = cropKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
                const cal = CROP_CALENDAR_DATA[cropKey];
                return (
                  <tr
                    key={cropKey}
                    className={`${isActive ? "bg-emerald-50/60" : "hover:bg-slate-50/40"} transition-colors`}
                  >
                    <td className="pr-2 py-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-medium ${
                          isActive ? "text-emerald-700" : "text-slate-600"
                        }`}>
                          {label}
                        </span>
                        {isActive && (
                          <span className="text-[9px] bg-emerald-200 text-emerald-800 px-1
                                           py-0.5 rounded-full font-semibold">
                            selected
                          </span>
                        )}
                      </div>
                    </td>
                    {cal.map((phase, i) => (
                      <td key={i} className="p-0.5">
                        <div
                          title={phase
                            ? phase.charAt(0).toUpperCase() + phase.slice(1)
                            : "Off-season"}
                          className={`w-7 h-6 rounded flex items-center justify-center
                                      text-[9px] font-bold transition-all ${
                            phase === "sow"     ? "bg-emerald-500 text-white"      :
                            phase === "grow"    ? "bg-emerald-100 text-emerald-600" :
                            phase === "harvest" ? "bg-amber-300 text-amber-900"    :
                                                  "bg-slate-50 text-slate-200"
                          } ${i === currentMonth ? "ring-2 ring-blue-400 ring-offset-1" : ""} ${
                            isActive ? "shadow-sm" : ""
                          }`}
                        >
                          {phase === "sow" ? "S" : phase === "harvest" ? "H" : phase === "grow" ? "" : ""}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 pb-4 pt-3 border-t bg-slate-50">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-500">S</strong> = Sowing window {" "}
            <strong className="text-slate-500"></strong> = Growing season {" "}
            <strong className="text-slate-500">H</strong> = Harvest period.
            Based on the typical Indian agricultural calendar for the majority of states.
            Actual dates vary by region, variety, and irrigation access.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [crops,            setCrops]            = useState([]);
  const [crop,             setCrop]             = useState("rice");
  const [features,         setFeatures]         = useState({ ...DEFAULTS });
  const [schema,           setSchema]           = useState([]);
  const [districts,        setDistricts]        = useState([]);
  const [distCode,         setDistCode]         = useState("");
  const [districtSearch,   setDistrictSearch]   = useState("");
  const [advisory,         setAdvisory]         = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState(null);
  const [modelInfo,        setModelInfo]        = useState(null);
  const [districtSummary,  setDistrictSummary]  = useState([]);
  const [summaryLoading,   setSummaryLoading]   = useState(false);
  const [weatherData,      setWeatherData]      = useState(null);
  const [weatherFields,    setWeatherFields]    = useState(new Set());
  const [seasonConditions, setSeasonConditions] = useState(null);
  const [seasonLoading,    setSeasonLoading]    = useState(false);
  const [weatherMode,      setWeatherMode]      = useState("archive");
  const [searchParams] = useSearchParams();
  const [calendarOpen,    setCalendarOpen]    = useState(false);
  const [scenarioA, setScenarioA] = useState(null);
  const scenarioB = advisory && scenarioA
    ? { advisory, inputs: { ...features }, crop }
    : null;
  const inputsAtSubmit = useRef({});

  // Filter districts by name, state, or code
  const filteredDistricts = districts.filter(d => {
    const q = districtSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(d.code).includes(q) ||
      (d.name  && d.name.toLowerCase().includes(q)) ||
      (d.state && d.state.toLowerCase().includes(q))
    );
  });

  const selectedDistrict = distCode
    ? districts.find(d => d.code === Number(distCode))
    : null;

  useEffect(() => {
    fetchCrops().then(setCrops).catch(() => {});
    fetchModelInfo().then(setModelInfo).catch(() => {});
  }, []);

  useEffect(() => {
    if (!crops.length) return;
    const urlCrop = searchParams.get("crop");
    const urlDist  = searchParams.get("dist");
    if (urlCrop && crops.includes(urlCrop)) setCrop(urlCrop);
    if (urlDist) setDistCode(urlDist);
  }, [searchParams, crops]);

  useEffect(() => {
    fetchCropSchema(crop).then(cols => {
      setSchema(cols);
      const priceCol = cols.find(c => c.includes("STATE_PRICE"));
      const irrCol   = cols.find(c => c.includes("IRRIGATED AREA"));
      const updated  = { ...DEFAULTS };
      if (priceCol) updated[priceCol] = 800;
      if (irrCol)   updated[irrCol]   = 50;
      // Keep district pre-fill if a district is already selected
      if (distCode) {
        const dist = districts.find(d => d.code === Number(distCode));
        if (dist) updated.YIELD_LAG_1 = dist.median;
      }
      setFeatures(updated);
      setAdvisory(null);
      setScenarioA(null);
    }).catch(() => {});

    fetchCropDistricts(crop)
      .then(setDistricts)
      .catch(() => setDistricts([]));
  }, [crop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!distCode) {
      setDistrictSummary([]);
      setWeatherData(null);
      setWeatherFields(new Set());
      return;
    }
    setSummaryLoading(true);
    fetchDistrictCropSummary(Number(distCode))
      .then(setDistrictSummary)
      .catch(() => setDistrictSummary([]))
      .finally(() => setSummaryLoading(false));

    // Auto-fill climate inputs from live Open-Meteo data (archive or forecast)
    const fetchWeatherFn = weatherMode === "forecast"
      ? fetchDistrictWeatherForecast
      : fetchDistrictWeather;
    fetchWeatherFn(Number(distCode)).then(w => {
      if (!w || w.error) return;
      setWeatherData(w);
      const filled = new Set();
      setFeatures(prev => {
        const next = { ...prev };
        if (w.annual_rainfall_mm != null) { next["ANNUAL RAINFALL (Millimeters)"] = w.annual_rainfall_mm; filled.add("ANNUAL RAINFALL (Millimeters)"); }
        if (w.kharif_tmax        != null) { next["KHARIF_TMAX"] = w.kharif_tmax; filled.add("KHARIF_TMAX"); }
        if (w.rabi_tmin          != null) { next["RABI_TMIN"]   = w.rabi_tmin;   filled.add("RABI_TMIN"); }
        return next;
      });
      setWeatherFields(filled);
    });
  }, [distCode, weatherMode]);

  useEffect(() => {
    if (!distCode || !weatherData) { setSeasonConditions(null); return; }
    setSeasonLoading(true);
    fetchSeasonConditions(crop, features)
      .then(setSeasonConditions)
      .catch(() => setSeasonConditions(null))
      .finally(() => setSeasonLoading(false));
  }, [crop, distCode, weatherData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!distCode || !districts.length) return;
    const dist = districts.find(d => d.code === Number(distCode));
    if (dist) setFeatures(prev => ({ ...prev, YIELD_LAG_1: dist.median }));
  }, [distCode, districts]);

  async function handlePredict() {
    for (const { key } of USER_FIELDS) {
      if (getFieldWarning(key, features[key])) {
        setError("Please fix the highlighted input fields before running an advisory.");
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const fullFeatures = {};
      for (const col of schema) {
        fullFeatures[col] = features[col] ?? DEFAULTS[col] ?? 0;
      }
      inputsAtSubmit.current = { ...features };
      const result = await getRecommendation(
        crop,
        fullFeatures,
        distCode ? Number(distCode) : null
      );
      result._climateFromWeather = weatherFields.size > 0;
      result._seasonConditions   = seasonConditions;
      setAdvisory(result);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to get prediction");
    } finally {
      setLoading(false);
    }
  }

  function saveScenarioA() {
    setScenarioA({ advisory, inputs: { ...inputsAtSubmit.current }, crop });
    setAdvisory(null);
  }

  function clearComparison() {
    setScenarioA(null);
    setAdvisory(null);
  }

  const updateFeature = (key, value) => {
    setFeatures(prev => ({ ...prev, [key]: Number(value) }));
    // User manually edited — remove weather badge for this field
    if (weatherFields.has(key)) {
      setWeatherFields(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const isComparing    = !!scenarioA;
  const cropShap       = modelInfo?.[crop]?.shap_top10 || {};
  const fieldImportance = buildFieldImportance(cropShap);

  // District name for the profile panel header
  const districtDisplayName = selectedDistrict
    ? (selectedDistrict.name
        ? `${selectedDistrict.name}, ${selectedDistrict.state}`
        : `District ${selectedDistrict.code}`)
    : "";

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          {isComparing
            ? "Scenario B — adjust parameters and run a second advisory to compare"
            : "Select a crop and district, adjust parameters, and get a yield advisory"}
        </p>
      </div>

      {/* Scenario A status bar */}
      {isComparing && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200
                        rounded-xl px-4 py-3 mb-4 text-sm">
          <div className="flex items-center gap-2 text-blue-800">
            <GitCompare size={16} />
            <span className="font-medium">Scenario A locked</span>
            <span className="text-blue-600">
              — {scenarioA.crop.replace("_", " ")}  {scenarioA.advisory.predicted_yield} Kg/ha  {scenarioA.advisory.level}
            </span>
          </div>
          <button onClick={clearComparison}
            className="text-xs text-blue-600 hover:text-blue-800 underline">
            Clear
          </button>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-white border rounded-xl p-5">

            {/* Crop selector */}
            <label className="block text-sm font-medium mb-2">Crop</label>
            <select value={crop} onChange={e => setCrop(e.target.value)}
              className="w-full p-2 border rounded-md mb-4 text-sm">
              {crops.map(c => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>

            <button
              onClick={() => setCalendarOpen(true)}
              className="mb-3 w-full flex items-center gap-1.5 text-xs text-slate-400
                         hover:text-emerald-700 transition justify-center py-1.5 border
                         border-dashed border-slate-200 rounded-lg hover:border-emerald-300
                         hover:bg-emerald-50"
            >
              📅
              <span className="underline underline-offset-2">View full planting calendar</span>
            </button>

            <PlantingWindowBanner crop={crop} />

            {/* District selector */}
            <div className="mb-4">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 mb-1 font-medium">
                <MapPin size={12} />
                District benchmark
                <span className="ml-auto text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                  <TrendingUp size={9} />
                  unlocks 50-yr trend chart
                </span>
              </label>

              {/* Selected district chip */}
              {selectedDistrict && (
                <div className="flex items-center justify-between bg-emerald-50 border
                                border-emerald-200 rounded-md px-2.5 py-1.5 mb-1">
                  <span className="text-xs font-medium text-emerald-800">
                    {selectedDistrict.name
                      ? `${selectedDistrict.name}, ${selectedDistrict.state}`
                      : `District ${selectedDistrict.code}`}
                  </span>
                  <button
                    onClick={() => { setDistCode(""); setDistrictSearch(""); }}
                    className="text-[10px] text-emerald-600 hover:text-emerald-800 underline ml-2"
                  >
                    clear
                  </button>
                </div>
              )}

              <input
                type="text"
                value={districtSearch}
                onChange={e => setDistrictSearch(e.target.value)}
                placeholder="Search by district name or code…"
                className="w-full p-2 border rounded-md text-sm text-slate-700
                           placeholder:text-slate-300 mb-1"
              />
              <select
                value={distCode}
                onChange={e => {
                  const newCode = e.target.value;
                  setDistCode(newCode);
                  setDistrictSearch("");
                  if (newCode) {
                    const dist = districts.find(d => d.code === Number(newCode));
                    if (dist) {
                      setFeatures(prev => ({ ...prev, YIELD_LAG_1: dist.median }));
                    }
                  }
                }}
                className="w-full p-2 border rounded-md text-sm text-slate-700 bg-white"
                size={districtSearch ? Math.min(filteredDistricts.length + 1, 7) : 1}
              >
                <option value="">National average (all districts)</option>
                {filteredDistricts.map(d => (
                  <option key={d.code} value={d.code}>
                    {districtLabel(d)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Benchmarks your prediction against district historical quartiles
              </p>
            </div>

            {/* Agronomic inputs */}
            <div className="space-y-3">
              {USER_FIELDS.map(({ key, label, step }) => {
                const importance = fieldImportance[key];
                const warning    = getFieldWarning(key, features[key]);
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs text-slate-600">{label}</label>
                      {importance && importance.rank <= 3 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium
                                         text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                          <TrendingUp size={9} />
                          #{importance.rank} factor for {crop.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <input
                      type="number" step={step}
                      value={features[key] ?? ""}
                      onChange={e => updateFeature(key, e.target.value)}
                      className={`w-full p-2 border rounded-md text-sm ${
                        warning
                          ? "border-amber-400 bg-amber-50/40"
                          : importance && importance.rank <= 3
                            ? "border-amber-200 bg-amber-50/30"
                            : ""
                      }`}
                    />
                    {warning && (
                      <p className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                        <AlertCircle size={11} />
                        {warning}
                      </p>
                    )}
                    {!warning && (() => {
                      const hint = getAgronomicHint(key, features[key], crop);
                      return hint ? (
                        <p className="flex items-start gap-1.5 text-[10px] text-amber-700 mt-1 leading-relaxed bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
                          <span className="shrink-0 mt-0.5">🌾</span>
                          {hint}
                        </p>
                      ) : null;
                    })()}
                    {key === "YIELD_LAG_1" && selectedDistrict && !warning && (
                      <p className="flex items-center gap-1 text-[10px] text-emerald-600 mt-1">
                        <MapPin size={9} />
                        Pre-filled with district median —{" "}
                        <strong className="mx-0.5">{selectedDistrict.median.toLocaleString()}</strong>{" "}
                        Kg/ha. Adjust if you have actual data.
                      </p>
                    )}
                    {weatherFields.has(key) && (
                      <p className="flex items-center gap-1 text-[10px] text-blue-500 mt-1">
                        {weatherMode === "forecast" ? "🔮" : "🌤"}{" "}
                        {weatherMode === "forecast"
                          ? "Forecast — auto-filled from Open-Meteo (16-day, annualised)"
                          : "Live — auto-filled from Open-Meteo (past 12 months)"}
                      </p>
                    )}
                    {weatherFields.has(key) && weatherData?.training_avg && WEATHER_OOD_META[key] && (() => {
                      const meta     = WEATHER_OOD_META[key];
                      const current  = weatherData[meta.trainKey];
                      const trainAvg = weatherData.training_avg[meta.trainKey];
                      if (current == null || trainAvg == null) return null;
                      const delta    = current - trainAvg;
                      const absD     = Math.abs(delta);
                      const deltaPct = Math.abs((delta / trainAvg) * 100);
                      const severity = meta.isTemp
                        ? (absD >= 5 ? "high" : absD >= 2 ? "medium" : null)
                        : (deltaPct >= 25 ? "high" : deltaPct >= 10 ? "medium" : null);
                      if (!severity) return null;
                      const arrow = delta > 0 ? "↑" : "↓";
                      const diffLabel = meta.isTemp
                        ? `${arrow} ${absD.toFixed(1)}C from training avg (${trainAvg}C)`
                        : `${arrow} ${deltaPct.toFixed(0)}% from training avg (${trainAvg} mm)`;
                      return (
                        <p className={`flex items-center gap-1 text-[10px] mt-0.5 font-semibold ${
                          severity === "high" ? "text-red-500" : "text-amber-500"
                        }`}>
                          <AlertCircle size={9} className="shrink-0" />
                          {severity === "high" ? "Outside training range" : "Near training boundary"} — {diffLabel}. Prediction extrapolates.
                        </p>
                      );
                    })()}
                    {key === "ANNUAL RAINFALL (Millimeters)" && !selectedDistrict && !warning && !weatherFields.has(key) && (
                      <p className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
                        <MapPin size={9} />
                        Select a district above to see local rainfall norms
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

           {weatherData && weatherFields.size > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 shrink-0">Weather source:</span>
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                    <button
                      onClick={() => setWeatherMode("archive")}
                      className={`px-3 py-1.5 transition ${weatherMode === "archive" ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                      📡 Archive
                    </button>
                    <button
                      onClick={() => setWeatherMode("forecast")}
                      className={`px-3 py-1.5 transition ${weatherMode === "forecast" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                      🔮 Forecast
                    </button>
                  </div>
                  {weatherMode === "forecast" && (
                    <span className="text-[10px] text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                      16-day forward projection — annualised
                    </span>
                  )}
                </div>
                {weatherMode === "forecast" && (
                  <p className="text-[10px] text-indigo-500 leading-relaxed px-0.5">
                    Forecast mode: temperature is the 16-day mean; rainfall is the 16-day total scaled to an annual equivalent. Use this to model expected conditions for the coming planting window.
                  </p>
                )}
              </div>
            )}
            {weatherData && weatherFields.size > 0 && (
              <ClimateContextPanel weatherData={weatherData} />
            )}

            <button onClick={handlePredict} disabled={loading}
              className="mt-5 w-full py-2.5 bg-slate-800 text-white rounded-lg font-medium
                         hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center
                         gap-2 transition">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? "Analysing…" : isComparing ? "Get Scenario B" : "Get Advisory"}
            </button>

            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-7 space-y-4">
          {advisory ? (
            <>
              <AdvisoryCard advisory={advisory} />
              {seasonConditions && (
                <SeasonOutlookCard conditions={seasonConditions} loading={false} />
              )}
              {!isComparing && districtSummary.length > 0 && (
                <CompactDistrictStrip
                  summary={districtSummary}
                  activeCrop={crop}
                  districtName={districtDisplayName}
                  onCropSelect={(newCrop) => { setCrop(newCrop); setAdvisory(null); }}
                />
              )}
              {!isComparing && districtSummary.length > 0 && (
                <CropRotationPanel
                  activeCrop={crop}
                  districtSummary={districtSummary}
                  districtName={districtDisplayName}
                  onCropSelect={(newCrop) => { setCrop(newCrop); setAdvisory(null); }}
                />
              )}
              {!isComparing && (
                <button onClick={saveScenarioA}
                  className="flex items-center gap-2 w-full justify-center py-2 border-2 border-dashed
                             border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600
                             rounded-xl text-sm font-medium transition">
                  <GitCompare size={16} />
                  Save as Scenario A to compare
                </button>
              )}
            </>
          ) : (
            <>
              {/* District Crop Profile — shown when district selected, no advisory yet */}
              {selectedDistrict && !isComparing && (
                summaryLoading ? (
                  <div className="bg-white border rounded-xl p-5 animate-pulse">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-4 h-4 bg-slate-200 rounded" />
                      <div className="h-4 bg-slate-200 rounded w-36" />
                    </div>
                    <div className="space-y-3">
                      {[80, 65, 50, 40, 30].map(w => (
                        <div key={w} className="rounded-lg px-3 py-2 bg-slate-50 border border-transparent">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-slate-200" />
                              <div className="h-3 bg-slate-200 rounded" style={{ width: `${w}px` }} />
                            </div>
                            <div className="h-3 bg-slate-200 rounded w-20" />
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <DistrictCropProfile
                      summary={districtSummary}
                      activeCrop={crop}
                      districtName={districtDisplayName}
                      onCropSelect={setCrop}
                    />
                    <SeasonOutlookCard
                      conditions={seasonConditions}
                      loading={seasonLoading}
                    />
                    <RiskCompare
                      distCode={distCode ? Number(distCode) : null}
                      districtName={districtDisplayName}
                      features={features}
                      onCropSelect={setCrop}
                    />
                  </>
                )
              )}

              {/* Advisory generating skeleton */}
              {loading && (
                <div className="bg-white border rounded-xl p-5 animate-pulse space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-200 rounded w-1/2" />
                      <div className="h-3 bg-slate-100 rounded w-1/3" />
                    </div>
                    <div className="w-20 h-7 bg-slate-200 rounded-full" />
                  </div>
                  <div className="h-5 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded-full w-full" />
                  <div className="grid grid-cols-3 gap-3">
                    {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 bg-slate-100 rounded w-full" />
                    <div className="h-3 bg-slate-100 rounded w-5/6" />
                    <div className="h-3 bg-slate-100 rounded w-4/6" />
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!loading && <div className={`bg-white border rounded-xl p-10 text-center text-slate-400
                              flex flex-col items-center justify-center
                              ${selectedDistrict && !isComparing ? "py-6" : ""}`}>
                {isComparing ? (
                  <>
                    <GitCompare size={32} className="mb-3 text-blue-300" />
                    <p className="font-medium text-slate-500">Scenario A is locked</p>
                    <p className="text-sm mt-1">Adjust the parameters and click "Get Scenario B"</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-slate-500">No advisory yet</p>
                    <p className="text-sm mt-1">
                      {selectedDistrict
                        ? `${districtDisplayName} profile loaded — click Get Advisory to predict`
                        : "Select a crop and click \"Get Advisory\""}
                    </p>
                    {!distCode && (
                      <p className="text-xs mt-3 text-emerald-600 flex items-center gap-1 justify-center">
                        <MapPin size={11} />
                        Tip: select a district to see its crop performance profile
                      </p>
                    )}
                  </>
                )}
              </div>}
            </>
          )}
        </div>
      </div>

      {/* Scenario comparison panel */}
      <ScenarioComparison
        scenarioA={scenarioA}
        scenarioB={scenarioB}
        onClear={clearComparison}
      />

      {/* Planting Calendar modal */}
      {calendarOpen && (
        <PlantingCalendar
          activeCrop={crop}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}
