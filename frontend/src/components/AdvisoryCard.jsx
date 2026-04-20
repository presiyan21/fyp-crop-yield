import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, AlertCircle, Check, Loader2, TrendingUp, Lightbulb, Info, Target, Gauge, BarChart3, Globe, IndianRupee, ChevronDown, Zap, ArrowRight, XCircle, CalendarDays } from "lucide-react";
import { acceptRecommendation, fetchCropDistricts, fetchSensitivity, fetchBacktest, fetchMonteCarlo, fetchOptimizeInputs, getPrediction } from "../lib/api";
import { getFeatureLabel, getFeatureMeta, isUserControllable, getConfidenceTier } from "../lib/featureLabels";
import YieldTrendChart from "../components/YieldTrendChart";
import { generateAdvisoryPDF } from "../lib/pdfReport";
import {
  LineChart, BarChart, Bar, Cell, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

const LEVEL_CONFIG = {
  green: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800",
           icon: CheckCircle, badge: "bg-emerald-100 text-emerald-700" },
  amber: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800",
           icon: AlertCircle, badge: "bg-amber-100 text-amber-700" },
  red:   { bg: "bg-red-50", border: "border-red-200", text: "text-red-800",
           icon: AlertTriangle, badge: "bg-red-100 text-red-700" },
};

const CONFIDENCE_BADGE = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber:   "bg-amber-100 text-amber-700",
  red:     "bg-red-100 text-red-700",
};

const ACTION_FEATURE_MAP = {
  irrigation:   "IRRIGATION_RATIO",
  fertilizer:   "NPK_TOTAL_KG_PER_HA",
  npk:          "NPK_TOTAL_KG_PER_HA",
  rainfall:     "ANNUAL RAINFALL (Millimeters)",
  heat:         "HEAT_STRESS",
  waterlogging: "ANNUAL RAINFALL (Millimeters)",
};

function getActionImpact(actionText, shapTop10) {
  if (!shapTop10) return null;
  const lower = actionText.toLowerCase();
  const shapFeatures = Object.keys(shapTop10);
  for (const [keyword, featureKey] of Object.entries(ACTION_FEATURE_MAP)) {
    if (lower.includes(keyword)) {
      const match = shapFeatures.find(f =>
        f === featureKey || f.includes(keyword.toUpperCase()) || featureKey.includes(f)
      );
      if (match) {
        const rank = [...shapFeatures].sort((a, b) => shapTop10[b] - shapTop10[a]).indexOf(match) + 1;
        if (rank <= 5) return "high";
        if (rank <= 10) return "moderate";
      }
    }
  }
  return null;
}

const XGB_R2 = {
  rice: 0.821, wheat: 0.813, maize: 0.688, sorghum: 0.426,
  pearl_millet: 0.448, chickpea: 0.436, pigeonpea: 0.462,
  groundnut: 0.476, cotton: 0.424, sugarcane: 0.673,
};

const XGB_RMSE = {
  rice: 410.6, wheat: 454.8, maize: 844.7, sorghum: 425.7,
  pearl_millet: 465.9, chickpea: 266.6, pigeonpea: 285.5,
  groundnut: 446.3, cotton: 154.7, sugarcane: 1556.7,
};

const MSP_PER_QUINTAL = {
  rice: 2300, wheat: 2275, maize: 2090, sorghum: 3371,
  pearl_millet: 2500, chickpea: 5440, pigeonpea: 7000,
  groundnut: 6377, cotton: 7121, sugarcane: 340,
};

function computeNationalStats(districts) {
  if (!districts || districts.length === 0) return null;
  const medians = districts.map(d => d.median).filter(Boolean).sort((a, b) => a - b);
  const q25s    = districts.map(d => d.q25).filter(Boolean).sort((a, b) => a - b);
  const q75s    = districts.map(d => d.q75).filter(Boolean).sort((a, b) => a - b);
  const mid = (arr) => arr[Math.floor(arr.length / 2)];
  return { median: mid(medians), q25: mid(q25s), q75: mid(q75s) };
}

function generateShapSummary(shap) {
  const sorted = Object.entries(shap).sort(([, a], [, b]) => b - a);
  const top2 = sorted.slice(0, 2).map(([f]) => getFeatureLabel(f).toLowerCase());
  if (top2.length >= 2) return `Yield is primarily driven by ${top2[0]} and ${top2[1]}.`;
  if (top2.length === 1) return `Yield is primarily driven by ${top2[0]}.`;
  return null;
}

export default function AdvisoryCard({ advisory }) {
  const [accepted,      setAccepted]      = useState(false);
  const [accepting,     setAccepting]     = useState(false);
  const [nationalStats, setNationalStats] = useState(null);
  const [benchmarkMode,  setBenchmarkMode]  = useState("district");
  const [generatingPDF,  setGeneratingPDF]  = useState(false);
  const [mcData,         setMcData]         = useState(null);
  const [optimizeData,   setOptimizeData]   = useState(null);
  const [multiYearData,  setMultiYearData]  = useState(null);

  const config = LEVEL_CONFIG[advisory?.level] || LEVEL_CONFIG.amber;
  const hasDistrict = !!advisory?.dist_code;

  useEffect(() => {
    if (!hasDistrict || !advisory?.crop) return;
    fetchCropDistricts(advisory.crop)
      .then((data) => {
        const stats = computeNationalStats(data.districts || data);
        if (stats) setNationalStats(stats);
      })
      .catch(() => {});
  }, [advisory?.crop, hasDistrict]);

  useEffect(() => { setBenchmarkMode("district"); }, [advisory?.recommendation_id]);

  if (!advisory) return null;
  const Icon   = config.icon;

  const r2   = XGB_R2[advisory.crop]   || 0;
  const rmse = XGB_RMSE[advisory.crop] || 0;
  const confidence  = getConfidenceTier(r2);
  const badgeClass  = CONFIDENCE_BADGE[confidence.colour] || CONFIDENCE_BADGE.amber;

  const ci       = advisory.conformal_interval;
  const predLow  = ci ? Math.max(0, ci.lower_90) : Math.max(0, advisory.predicted_yield - rmse);
  const predHigh = ci ? ci.upper_90 : advisory.predicted_yield + rmse;
  const ciHalf   = ci ? ci.q90 : rmse;
  const ciLabel  = ci ? `90% interval (n=${ci.n_calibration} test obs.)` : "RMSE estimate";

  async function handleAccept() {
    if (accepted || accepting || !advisory.recommendation_id) return;
    setAccepting(true);
    try {
      await acceptRecommendation(advisory.recommendation_id);
      setAccepted(true);
    } catch (e) {
      console.error("Accept failed", e);
    } finally {
      setAccepting(false);
    }
  }

  const gaugeStats = (benchmarkMode === "national" && nationalStats)
    ? { ...advisory, hist_q25: nationalStats.q25, hist_median: nationalStats.median, hist_q75: nationalStats.q75 }
    : advisory;

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border p-5 ${config.bg} ${config.border}`}>
        <div className="flex items-start gap-4">
          <div className="mt-0.5"><Icon size={28} className={config.text} /></div>
          <div className="flex-1 min-w-0">

            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.badge}`}>
                {advisory.level.toUpperCase()}
              </span>
              <span className="text-xs text-slate-500 capitalize">
                {advisory.crop.replace(/_/g, " ")}
              </span>
              {advisory.district_name && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <svg width="9" height="11" viewBox="0 0 9 11" fill="none" className="inline shrink-0">
                    <path d="M4.5 0C2.015 0 0 2.015 0 4.5c0 3.375 4.5 6.5 4.5 6.5S9 7.875 9 4.5C9 2.015 6.985 0 4.5 0Zm0 6.125A1.625 1.625 0 1 1 4.5 2.875a1.625 1.625 0 0 1 0 3.25Z" fill="currentColor"/>
                  </svg>
                  {advisory.district_name}
                </span>
              )}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
                {confidence.label}
              </span>
            </div>

            <h3 className={`text-lg font-semibold ${config.text}`}>{advisory.headline}</h3>

            {hasDistrict && nationalStats && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-slate-500">Benchmark:</span>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                  <button
                    onClick={() => setBenchmarkMode("district")}
                    className={`px-3 py-1 transition ${benchmarkMode === "district"
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    District
                  </button>
                  <button
                    onClick={() => setBenchmarkMode("national")}
                    className={`px-3 py-1 transition flex items-center gap-1 ${benchmarkMode === "national"
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    <Globe size={10} /> National
                  </button>
                </div>
                {benchmarkMode === "national" && (
                  <span className="text-xs text-slate-400">
                    National median: {nationalStats.median.toLocaleString()} Kg/ha
                  </span>
                )}
              </div>
            )}

            <YieldGauge advisory={gaugeStats} rmse={ciHalf} ciLabel={ciLabel} benchmarkMode={benchmarkMode} />

            {advisory.ood_warnings?.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800 mb-1">
                      Input outside training range
                    </p>
                    <ul className="space-y-1">
                      {advisory.ood_warnings.map((w, i) => (
                        <li key={i} className="text-xs text-amber-700 leading-snug">{w}</li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-amber-600 mt-1.5">
                      The model was trained on 1966–2005 data. Inputs far outside that range may reduce prediction reliability.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <YieldTrendChart
              crop={advisory.crop}
              distCode={advisory.dist_code}
              predictedYield={advisory.predicted_yield}
            />

            {advisory.actions?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-slate-700 mb-2">Recommendations</h4>
                <ul className="space-y-2">
                  {advisory.actions.map((action, i) => {
                    const impact = getActionImpact(action, advisory.shap_top10);
                    return (
                      <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                        <span className="flex-1">
                          {action}
                          {impact === "high" && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                              <TrendingUp size={10} /> High-impact factor
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-black/5 flex items-center gap-3">
              <button onClick={handleAccept} disabled={accepted || accepting}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition
                  ${accepted
                    ? "bg-emerald-600 text-white cursor-default"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"}`}>
                {accepting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {accepted ? "Advisory Accepted" : "Accept Advisory"}
              </button>
              <div className="flex flex-col items-start gap-1">
                <button
                  onClick={() => generateAdvisoryPDF(
                    { ...advisory, _mcData: mcData, _optimizeData: optimizeData, _multiYearData: multiYearData },
                    () => setGeneratingPDF(true),
                    () => setGeneratingPDF(false)
                  )}
                  disabled={generatingPDF}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
                  {generatingPDF
                    ? <Loader2 size={14} className="animate-spin" />
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>}
                  {generatingPDF ? "Generating PDF…" : "Download PDF Report"}
                </button>
                {(!mcData || !optimizeData) && (
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Info size={9} />
                    Expand Weather Uncertainty {!optimizeData && advisory.level !== "green" ? "and Upgrade Path" : ""} below for a fuller PDF report.
                  </p>
                )}
              </div>
             </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Target size={12} /> Confidence range
          </div>
          <div className="font-semibold text-sm text-slate-800">
            {predLow.toFixed(0)} &ndash; {predHigh.toFixed(0)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Kg/ha &middot; {ciLabel}</div>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Gauge size={12} /> Model accuracy
          </div>
          <div className="font-semibold text-sm text-slate-800">{(r2 * 100).toFixed(1)}%</div>
          <div className="text-[10px] text-slate-400 mt-0.5">of variation explained</div>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <BarChart3 size={12} /> Typical error
          </div>
          <div className="font-semibold text-sm text-slate-800">&plusmn;{rmse.toFixed(0)} Kg/ha</div>
          <div className="text-[10px] text-slate-400 mt-0.5">average deviation</div>
        </div>
      </div>

      {(advisory.shap_local || advisory.shap_top10) && (
        <ShapExplanation
          shap={advisory.shap_top10}
          shapLocal={advisory.shap_local}
          shapBase={advisory.shap_base}
          crop={advisory.crop}
        />
      )}

      <EconomicImpactPanel advisory={advisory} rmse={rmse} />
      <UpgradePathPanel advisory={advisory} onOptimizeData={setOptimizeData} />
      <BacktestPanel advisory={advisory} />
      <SensitivityPanel advisory={advisory} />
      <MonteCarloPanel advisory={advisory} onDataLoaded={setMcData} />
      <MultiYearPanel advisory={advisory} onPlanData={setMultiYearData} />
    </div>
  );
}

function YieldGauge({ advisory, rmse = 0, ciLabel = "model uncertainty", benchmarkMode = "district" }) {
  const { predicted_yield, hist_q25, hist_median, hist_q75 } = advisory;

  const range   = hist_q75 - hist_q25;
  const padding = range * 0.35;
  const scaleMin   = Math.max(0, hist_q25 - padding);
  const scaleMax   = hist_q75 + padding;
  const totalRange = scaleMax - scaleMin;

  const clampedPred  = Math.max(scaleMin, Math.min(scaleMax, predicted_yield));
  const predPct = ((clampedPred  - scaleMin) / totalRange) * 100;
  const q25Pct  = ((hist_q25    - scaleMin) / totalRange) * 100;
  const medPct  = ((hist_median  - scaleMin) / totalRange) * 100;
  const q75Pct  = ((hist_q75    - scaleMin) / totalRange) * 100;

  const rmseLow      = Math.max(scaleMin, predicted_yield - rmse);
  const rmseHigh     = Math.min(scaleMax, predicted_yield + rmse);
  const rmseLeftPct  = ((rmseLow  - scaleMin) / totalRange) * 100;
  const rmseWidthPct = ((rmseHigh - rmseLow)  / totalRange) * 100;

  const diff           = predicted_yield - hist_median;
  const diffSign       = diff >= 0 ? "+" : "";
  const diffColour     = diff >= 0 ? "text-emerald-700" : "text-red-700";
  const benchmarkLabel = benchmarkMode === "national" ? "national median" : "district median";

  return (
    <div className="mt-4 bg-white/60 rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-semibold text-slate-800">
          {predicted_yield.toLocaleString()} Kg/ha
        </span>
        <span className={`text-sm font-medium ${diffColour}`}>
          {diffSign}{diff.toFixed(0)} vs {benchmarkLabel}
        </span>
      </div>

      <div className="relative h-3 rounded-full bg-slate-200 mt-2 mb-1">
        <div className="absolute h-full rounded-l-full bg-red-200"
          style={{ left: 0, width: `${q25Pct}%` }} />
        <div className="absolute h-full bg-amber-200"
          style={{ left: `${q25Pct}%`, width: `${medPct - q25Pct}%` }} />
        <div className="absolute h-full bg-emerald-200"
          style={{ left: `${medPct}%`, width: `${q75Pct - medPct}%` }} />
        <div className="absolute h-full rounded-r-full bg-emerald-100"
          style={{ left: `${q75Pct}%`, width: `${100 - q75Pct}%` }} />
        {rmse > 0 && (
          <div className="absolute h-full bg-slate-600/20 border-x border-slate-500/40"
            style={{ left: `${rmseLeftPct}%`, width: `${rmseWidthPct}%` }}
            title={`Uncertainty band: +/-${rmse} Kg/ha`} />
        )}
        <div className="absolute top-0 w-0.5 h-full bg-slate-500" style={{ left: `${medPct}%` }} />
        <div className="absolute -top-1 w-4 h-5 flex flex-col items-center"
          style={{ left: `${predPct}%`, transform: "translateX(-50%)" }}>
          <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px]
                          border-l-transparent border-r-transparent border-t-slate-800" />
        </div>
      </div>

      <div className="relative h-4 text-[10px] text-slate-500">
        <span className="absolute" style={{ left: `${q25Pct}%`, transform: "translateX(-50%)" }}>
          Q25: {hist_q25.toLocaleString()}
        </span>
        <span className="absolute font-medium text-slate-600"
          style={{ left: `${medPct}%`, transform: "translateX(-50%)" }}>
          Median: {hist_median.toLocaleString()}
        </span>
        <span className="absolute" style={{ left: `${q75Pct}%`, transform: "translateX(-50%)" }}>
          Q75: {hist_q75.toLocaleString()}
        </span>
      </div>

      {rmse > 0 && (
        <p className="text-[10px] text-slate-400 mt-2">
          Shaded band: &plusmn;{rmse.toFixed(0)} Kg/ha &middot; {ciLabel}
        </p>
      )}
    </div>
  );
}

function ShapExplanation({ shap, shapLocal, shapBase, crop }) {
  const [viewMode, setViewMode] = useState("local");

  const hasLocal  = shapLocal && Object.keys(shapLocal).length > 0;
  const hasGlobal = shap      && Object.keys(shap).length      > 0;
  const showLocal = hasLocal && viewMode === "local";

  const localSorted = hasLocal
    ? Object.entries(shapLocal).sort(([, a], [, b]) => Math.abs(b) - Math.abs(a)).slice(0, 7)
    : [];
  const maxAbsLocal = localSorted.length
    ? Math.max(...localSorted.map(([, v]) => Math.abs(v))) || 1
    : 1;

  const globalSorted = hasGlobal
    ? Object.entries(shap).sort(([, a], [, b]) => b - a).slice(0, 7)
    : [];
  const maxGlobal       = globalSorted[0]?.[1] || 1;
  const shapSummary     = hasGlobal ? generateShapSummary(shap) : null;
  const localCtrlCount  = localSorted.filter(([f]) => isUserControllable(f)).length;

  return (
    <div className="bg-white border rounded-xl p-5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-amber-500" />
          <h4 className="text-sm font-semibold text-slate-800">
            {showLocal ? "Why this specific prediction?" : `What drives ${crop.replace(/_/g, " ")} yield?`}
          </h4>
        </div>
        {hasLocal && hasGlobal && (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium shrink-0">
            <button
              onClick={() => setViewMode("local")}
              className={`px-2.5 py-1 transition ${viewMode === "local"
                ? "bg-slate-800 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              Your inputs
            </button>
            <button
              onClick={() => setViewMode("global")}
              className={`px-2.5 py-1 transition ${viewMode === "global"
                ? "bg-slate-800 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              Crop average
            </button>
          </div>
        )}
      </div>

      {showLocal ? (
        <>
          <p className="text-xs text-slate-500 mb-4">
            How each factor shifted <span className="font-medium text-slate-700">your</span> prediction
            from the model baseline
            {shapBase != null && (
              <span className="text-slate-600 font-medium"> ({shapBase.toLocaleString()} Kg/ha)</span>
            )}.
            {localCtrlCount > 0 && (
              <span className="text-blue-600 font-medium"> {localCtrlCount} are inputs you can adjust.</span>
            )}
          </p>

          <div className="space-y-3">
            {localSorted.map(([feature, value]) => {
              const isPos        = value >= 0;
              const barPct       = (Math.abs(value) / maxAbsLocal) * 100;
              const controllable = isUserControllable(feature);
              return (
                <div key={feature} className="flex items-center gap-2">
                  <div className="w-36 shrink-0 text-right">
                    <div className="text-xs font-medium text-slate-700 truncate" title={feature}>
                      {getFeatureLabel(feature)}
                    </div>
                    <div className={`text-[10px] font-semibold ${isPos ? "text-emerald-600" : "text-red-600"}`}>
                      {isPos ? "+" : ""}{value.toFixed(0)} Kg/ha
                      {controllable && <span className="text-blue-500 font-normal ml-1">· yours</span>}
                    </div>
                  </div>
                  {/* Centred diverging bar */}
                  <div className="flex-1 flex items-center h-5">
                    <div className="w-1/2 flex justify-end pr-px">
                      {!isPos && (
                        <div
                          className="h-3 rounded-l bg-red-400 transition-all duration-500"
                          style={{ width: `${barPct}%` }}
                        />
                      )}
                    </div>
                    <div className="w-px h-5 bg-slate-300 shrink-0" />
                    <div className="w-1/2 pl-px">
                      {isPos && (
                        <div
                          className="h-3 rounded-r bg-emerald-400 transition-all duration-500"
                          style={{ width: `${barPct}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-3 h-2.5 rounded-sm bg-emerald-400" /> Pushed yield higher
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-3 h-2.5 rounded-sm bg-red-400" /> Pushed yield lower
            </div>
            <div className="ml-auto flex items-start gap-1">
              <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
              <p className="text-[10px] text-slate-400">Per-prediction SHAP via XGBoost TreeExplainer. SHAP values show association, not causation.</p>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">
            Average importance across the 2006–2015 test set for {crop.replace(/_/g, " ")}.
            {(() => {
              const gc = globalSorted.filter(([f]) => isUserControllable(f)).length;
              return gc > 0
                ? <span className="text-blue-600 font-medium"> {gc} of the top factors are inputs you control.</span>
                : null;
            })()}
          </p>

          {shapSummary && (
            <div className="mb-4 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg flex items-start gap-2">
              <Info size={13} className="text-indigo-400 mt-0.5 shrink-0" />
              <p className="text-xs text-indigo-800 font-medium leading-relaxed">{shapSummary}</p>
            </div>
          )}

          <div className="space-y-2">
            {globalSorted.map(([feature, value]) => {
              const meta         = getFeatureMeta(feature);
              const pct          = (value / maxGlobal) * 100;
              const controllable = isUserControllable(feature);
              return (
                <div key={feature} className="flex items-center gap-3">
                  <div className="w-40 shrink-0">
                    <div className="text-xs text-slate-700 font-medium truncate" title={feature}>
                      {getFeatureLabel(feature)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {meta.category}
                      {controllable && <span className="ml-1 text-blue-500 font-medium">&middot; Your input</span>}
                    </div>
                  </div>
                  <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-500 ${controllable ? "bg-blue-500" : "bg-slate-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-10 text-xs text-right text-slate-500 tabular-nums shrink-0">
                    {value.toFixed(0)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 flex items-start gap-2">
            <Info size={12} className="text-slate-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Global SHAP analysis of the XGBoost model averaged across the test dataset (2006–2015).
              Switch to <span className="font-medium">Your inputs</span> view for a prediction-specific breakdown.
              <span className="text-blue-500"> Blue bars</span> are factors you can adjust above.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function BacktestPanel({ advisory }) {
  const [open,    setOpen]    = useState(false);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [error,   setError]   = useState(null);

  if (!advisory.dist_code) return null;

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !fetched) {
      setLoading(true);
      try {
        const res = await fetchBacktest(advisory.crop, advisory.dist_code);
        setData(res.backtest || []);
      } catch (e) {
        setError(e.response?.data?.error || "No backtest data for this district");
      } finally {
        setLoading(false);
        setFetched(true);
      }
    }
  }

  const stats = (() => {
    if (!data || data.length === 0) return null;
    const mae     = Math.round(data.reduce((s, r) => s + Math.abs(r.actual - r.predicted), 0) / data.length);
    const avgBias = (data.reduce((s, r) => s + r.error_pct, 0) / data.length).toFixed(1);
    const overCount  = data.filter(r => r.error_pct < 0).length;
    const underCount = data.filter(r => r.error_pct > 0).length;
    const r2rows = data.filter(r => r.actual && r.predicted);
    const meanActual = r2rows.reduce((s, r) => s + r.actual, 0) / r2rows.length;
    const ssTot = r2rows.reduce((s, r) => s + Math.pow(r.actual - meanActual, 2), 0);
    const ssRes = r2rows.reduce((s, r) => s + Math.pow(r.actual - r.predicted, 2), 0);
    const r2    = ssTot > 0 ? (1 - ssRes / ssTot).toFixed(3) : "N/A";
    return { mae, avgBias, overCount, underCount, r2 };
  })();

  const chartData = (data || []).map(r => ({
    year:      r.Year,
    actual:    Math.round(r.actual),
    predicted: Math.round(r.predicted),
    error:     r.error_pct,
  }));

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 transition text-left"
      >
        <div className="flex items-center gap-2">
          <Target size={15} className="text-indigo-500" />
          <span className="text-sm font-semibold text-slate-700">
            Model Accuracy — This District (2006–2015)
          </span>
          {stats && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
              MAE {stats.mae.toLocaleString()} Kg/ha
            </span>
          )}
        </div>
        <ChevronDown size={15} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t bg-slate-50 px-4 pt-3 pb-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-6 gap-2 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading district backtest…
            </div>
          )}

          {error && (
            <div className="text-xs text-slate-500 py-4 text-center">{error}</div>
          )}

          {data && data.length > 0 && stats && (
            <>
              <p className="text-xs text-slate-500">
                How well the model predicted <span className="font-medium capitalize">{advisory.crop.replace(/_/g, " ")}</span> yields
                in <span className="font-medium">{advisory.district_name}</span> on the held-out test set.
                This district was never seen during training.
              </p>

              <div className="grid grid-cols-4 gap-2">
                <div className="bg-white rounded-lg border p-2.5 text-center">
                  <div className="text-base font-bold text-slate-800">{stats.mae.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">MAE (Kg/ha)</div>
                </div>
                <div className="bg-white rounded-lg border p-2.5 text-center">
                  <div className={`text-base font-bold ${parseFloat(stats.avgBias) < 0 ? "text-amber-600" : "text-blue-600"}`}>
                    {stats.avgBias >= 0 ? "+" : ""}{stats.avgBias}%
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {parseFloat(stats.avgBias) < 0 ? "Overestimate bias" : "Underestimate bias"}
                  </div>
                </div>
                <div className="bg-white rounded-lg border p-2.5 text-center">
                  <div className="text-base font-bold text-slate-800">{stats.r2}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Local R²</div>
                </div>
                <div className="bg-white rounded-lg border p-2.5 text-center">
                  <div className="text-base font-bold text-slate-800">{data.length}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Test years</div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Actual vs Predicted — {advisory.district_name}
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                           tickFormatter={v => v.toLocaleString()} width={56} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-white border rounded-lg shadow-md p-2.5 text-xs">
                          <p className="font-semibold text-slate-700 mb-1">{d.year}</p>
                          <p className="text-emerald-600">Actual: {d.actual?.toLocaleString()} Kg/ha</p>
                          <p className="text-indigo-500">Predicted: {d.predicted?.toLocaleString()} Kg/ha</p>
                          <p className={`mt-1 font-medium ${d.error < 0 ? "text-amber-600" : "text-blue-600"}`}>
                            Error: {d.error >= 0 ? "+" : ""}{d.error}%
                          </p>
                        </div>
                      );
                    }} />
                    <Legend
                      iconType="line"
                      formatter={v => <span className="text-[10px] text-slate-500">{v}</span>}
                    />
                    <Line dataKey="actual" name="Actual" stroke="#10b981" strokeWidth={2}
                          dot={{ r: 3, fill: "#10b981" }} activeDot={{ r: 5 }} />
                    <Line dataKey="predicted" name="Predicted" stroke="#6366f1" strokeWidth={2}
                          strokeDasharray="4 2" dot={{ r: 3, fill: "#6366f1" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <p className="text-[10px] text-slate-400 border-t border-slate-200 pt-2">
                This district's MAE (<span className="font-medium text-slate-500">{stats.mae.toLocaleString()} Kg/ha</span>) vs model-wide RMSE (<span className="font-medium text-slate-500">±{(XGB_RMSE[advisory.crop] || 0).toFixed(0)} Kg/ha</span>) — local performance can vary significantly from the global average, which averages across all 311 districts. Test window: 2006–2015 · Training cutoff: 2005 · No data leakage.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EconomicImpactPanel({ advisory, rmse }) {
  const [open, setOpen] = useState(false);
  const msp = MSP_PER_QUINTAL[advisory.crop];
  if (!msp) return null;

  const ci       = advisory.conformal_interval;
  const ciLabel  = ci ? `90% interval (n=${ci.n_calibration} test obs.)` : "RMSE estimate";
  const predLow  = ci ? Math.max(0, ci.lower_90) : Math.max(0, advisory.predicted_yield - rmse);
  const predHigh = ci ? ci.upper_90 : advisory.predicted_yield + rmse;

  const revenue       = (advisory.predicted_yield / 100) * msp;
  const revenueMedian = (advisory.hist_median / 100) * msp;
  const delta         = revenue - revenueMedian;
  const revenueLow    = (predLow  / 100) * msp;
  const revenueHigh   = (predHigh / 100) * msp;

  const fmt        = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const isPositive = delta >= 0;
  const cropLabel  = advisory.crop.replace(/_/g, " ");

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <IndianRupee size={16} className="text-emerald-600 shrink-0" />
          <span className="text-sm font-semibold text-slate-800">Economic Impact</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isPositive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}>
            {isPositive ? "+" : ""}{fmt(delta)} vs district avg
          </span>
        </div>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform shrink-0 ml-2 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100">
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-base font-bold text-slate-800">{fmt(revenue)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Estimated revenue / ha</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${isPositive ? "bg-emerald-50" : "bg-red-50"}`}>
              <div className={`text-base font-bold ${isPositive ? "text-emerald-700" : "text-red-700"}`}>
                {isPositive ? "+" : ""}{fmt(delta)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">vs district median</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-xs font-semibold text-slate-700 leading-tight">
                {fmt(revenueLow)} – {fmt(revenueHigh)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Revenue range (90% interval)</div>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 px-1">
            <Info size={12} className="text-slate-300 mt-0.5 shrink-0" />
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Based on 2024–25 Government of India Minimum Support Price (MSP) of{" "}
              <span className="font-medium text-slate-500">₹{msp}/quintal</span> for {cropLabel}.
              Assumes 1 hectare of cultivation. Actual market prices may differ from MSP.
              Revenue range reflects model uncertainty ({ciLabel}).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function SensitivityPanel({ advisory }) {
  const [open,        setOpen]        = useState(false);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [fetched,     setFetched]     = useState(false);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !fetched && advisory.crop && advisory.inputs) {
      setLoading(true);
      try {
        const res = await fetchSensitivity(advisory.crop, advisory.inputs, advisory.dist_code);
        setData(res);
      } catch (e) {
        console.error("Sensitivity fetch failed", e);
      } finally {
        setLoading(false);
        setFetched(true);
      }
    }
  }

  const rows = data
    ? Object.entries(data.sensitivity).filter(([, pts]) => pts.length > 0)
    : [];

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition text-left">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-indigo-500 shrink-0" />
          <span className="text-sm font-semibold text-slate-800">What-If Sensitivity</span>
          <span className="text-xs text-slate-400">How yield changes if inputs shift ±30%</span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ml-2 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100">
          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> Calculating sensitivities…
            </div>
          )}

          {!loading && rows.length === 0 && fetched && (
            <p className="text-xs text-slate-400 py-4 text-center">No sensitivity data available.</p>
          )}

          {!loading && rows.length > 0 && (
            <div className="mt-4 space-y-6">
              {rows.map(([feature, pts]) => {
                const maxAbs = Math.max(...pts.map(p => Math.abs(p.delta)), 1);
                const best   = pts.reduce((a, b) => b.delta > a.delta ? b : a);
                const worst  = pts.reduce((a, b) => b.delta < a.delta ? b : a);
                const BAR_H  = 52;

                return (
                  <div key={feature}>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <span className="text-xs font-semibold text-slate-700 shrink-0">
                        {getFeatureLabel(feature)}
                      </span>
                      <span className="text-[10px] text-slate-400 text-right leading-relaxed">
                        Best: <span className="text-emerald-600 font-medium">{best.delta >= 0 ? "+" : ""}{best.delta} Kg/ha</span>
                        {" "}at <span className="font-medium">{best.pct > 0 ? "+" : ""}{best.pct}%</span>
                        {worst.delta < 0 && (
                          <> &nbsp;·&nbsp; Worst: <span className="text-red-500 font-medium">{worst.delta} Kg/ha</span>
                          {" "}at <span className="font-medium">{worst.pct}%</span></>
                        )}
                      </span>
                    </div>

                    <div className="flex gap-1" style={{ height: `${BAR_H}px` }}>
                      {pts.map((pt) => {
                        const isBase = pt.pct === 0;
                        const isPos  = pt.delta >= 0;
                        const px     = isBase ? 3 : Math.max(Math.round((Math.abs(pt.delta) / maxAbs) * BAR_H), 6);
                        return (
                          <div key={pt.pct} className="flex-1 flex flex-col justify-end items-center group relative">
                            <div
                              className={`w-full rounded-sm transition-all ${
                                isBase ? "bg-slate-200" : isPos ? "bg-emerald-400" : "bg-red-400"
                              }`}
                              style={{ height: `${px}px` }}
                            />
                            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
                              {pt.pct > 0 ? "+" : ""}{pt.pct}% → {pt.delta >= 0 ? "+" : ""}{pt.delta} Kg/ha
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex gap-1 mt-1">
                      {pts.map((pt) => (
                        <div key={pt.pct} className="flex-1 text-center">
                          <span className={`text-[9px] tabular-nums ${pt.pct === 0 ? "text-slate-500 font-semibold" : "text-slate-400"}`}>
                            {pt.pct > 0 ? "+" : ""}{pt.pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="flex items-start gap-1.5 pt-2 border-t border-slate-100">
                <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Each bar shows the predicted yield change if that single input is varied by the
                  shown percentage, holding all other inputs constant. Base yield: {data.base_yield.toLocaleString()} Kg/ha.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UpgradePathPanel({ advisory, onOptimizeData }) {
  const [open,    setOpen]    = useState(false);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  if (advisory.level === "green") return null;

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !fetched && advisory.crop && advisory.inputs) {
      setLoading(true);
      try {
        const res = await fetchOptimizeInputs(advisory.crop, advisory.inputs, advisory.dist_code);
        setData(res);
        if (onOptimizeData) onOptimizeData(res);
      } catch (e) {
        console.error("Optimize inputs failed", e);
      } finally {
        setLoading(false);
        setFetched(true);
      }
    }
  }

  const feasible = data?.optimizations?.filter(o => o.feasible) || [];
  const infeasible = data?.optimizations?.filter(o => !o.feasible) || [];
  const badgeColour = advisory.level === "red"
    ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-700";

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap size={16} className="text-amber-500 shrink-0" />
          <span className="text-sm font-semibold text-slate-800">Upgrade Path to Green</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeColour}`}>
            {advisory.level.toUpperCase()} advisory
          </span>
          <span className="text-xs text-slate-400">Minimum intervention needed</span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ml-2 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100">
          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> Computing minimum intervention…
            </div>
          )}

          {!loading && fetched && !data && (
            <p className="text-xs text-slate-400 py-4 text-center">Optimisation unavailable for this advisory.</p>
          )}

          {!loading && data?.already_green && (
            <div className="mt-4 flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <CheckCircle size={18} className="text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800">This advisory is already at Green level — no intervention needed.</p>
            </div>
          )}

          {!loading && data && !data.already_green && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>Current yield:</span>
                <span className="font-semibold text-slate-800">{data.base_yield.toLocaleString()} Kg/ha</span>
                <ArrowRight size={12} className="text-slate-300" />
                <span>Target (Green):</span>
                <span className="font-semibold text-emerald-700">{data.target_yield.toLocaleString()} Kg/ha</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  data.gap > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                }`}>
                  gap: {data.gap.toLocaleString()} Kg/ha
                </span>
              </div>

              {feasible.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                    Paths to Green — each applied independently
                  </p>
                  {feasible.map((opt) => (
                    <div key={opt.field} className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <Zap size={16} className="text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-sm font-semibold text-emerald-900">{opt.label}</span>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800">
                              +{opt.yield_gain.toLocaleString()} Kg/ha
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-mono bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-700">
                              {opt.current} {opt.unit}
                            </span>
                            <ArrowRight size={14} className="text-emerald-500 shrink-0" />
                            <span className="text-sm font-mono bg-emerald-100 border border-emerald-300 rounded px-2 py-0.5 font-bold text-emerald-800">
                              {opt.recommended} {opt.unit}
                            </span>
                            <span className="text-xs text-emerald-700 font-medium">
                              (+{opt.change_pct > 0 ? opt.change_pct : Math.abs(opt.change_pct)}% increase)
                            </span>
                          </div>

                          <div className="relative h-1.5 bg-slate-200 rounded-full overflow-hidden mb-2">
                            <div className="absolute h-full bg-red-400 rounded-full"
                              style={{ width: `${Math.min(100, (opt.current / opt.recommended) * 100)}%` }} />
                            <div className="absolute h-full bg-emerald-400 rounded-full"
                              style={{ width: "100%", opacity: 0.3 }} />
                          </div>

                          <p className="text-xs text-emerald-800 leading-relaxed">
                            Raising <span className="font-medium">{opt.label.toLowerCase()}</span> from{" "}
                            <span className="font-semibold">{opt.current}</span> to{" "}
                            <span className="font-semibold">{opt.recommended} {opt.unit}</span> is projected to
                            move this advisory to <span className="font-semibold text-emerald-700">Green</span>{" "}
                            at <span className="font-semibold">{opt.new_yield.toLocaleString()} Kg/ha</span> — holding
                            all other inputs constant.
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {infeasible.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                    Insufficient alone
                  </p>
                  {infeasible.map((opt) => (
                    <div key={opt.field} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start gap-2">
                        <XCircle size={15} className="text-slate-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-xs font-semibold text-slate-700">{opt.label}</span>
                          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{opt.reason}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {feasible.length === 0 && infeasible.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 mb-1">
                      {data.combined_path
                        ? "Neither input sufficient alone — combined path available"
                        : "Weather is the binding constraint"}
                    </p>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      {data.combined_path
                        ? <>Under current weather, neither irrigation nor NPK alone can reach the district median. However, raising <span className="font-medium">both together</span> with smaller individual increases does — see the combined path below.</>
                        : <>Under current weather conditions, neither irrigation nor fertiliser alone can bring yield to the district median. Your inputs are <span className="font-medium">{Math.round((data.gap / data.base_yield) * 100)}% below target</span> and the gap exceeds what agronomic interventions can close. Use the <span className="font-medium">What-If Climate Planner</span> to identify which crops remain viable under these conditions.</>
                      }
                    </p>
                  </div>
                </div>
              )}

              {data.combined_path && (() => {
                const cp = data.combined_path;
                const bothInfeasible = feasible.length === 0 && infeasible.length > 0;
                return (
                  <div className={`rounded-xl border p-4 ${bothInfeasible ? "border-blue-200 bg-blue-50" : "border-indigo-100 bg-indigo-50"}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${bothInfeasible ? "bg-blue-100" : "bg-indigo-100"}`}>
                        <Zap size={16} className={bothInfeasible ? "text-blue-600" : "text-indigo-500"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`text-sm font-semibold ${bothInfeasible ? "text-blue-900" : "text-indigo-900"}`}>
                            {bothInfeasible ? "Combined Intervention — Rescue Path" : "Alternative: Combine Both Inputs"}
                          </span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${bothInfeasible ? "bg-blue-200 text-blue-800" : "bg-indigo-200 text-indigo-800"}`}>
                            +{cp.yield_gain.toLocaleString()} Kg/ha
                          </span>
                        </div>

                        <div className="space-y-2 mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-slate-500 w-20 shrink-0">Irrigation</span>
                            <span className="text-sm font-mono bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-700">{cp.irr_current}</span>
                            <ArrowRight size={12} className={bothInfeasible ? "text-blue-400 shrink-0" : "text-indigo-400 shrink-0"} />
                            <span className={`text-sm font-mono border rounded px-2 py-0.5 font-bold ${bothInfeasible ? "bg-blue-100 border-blue-300 text-blue-800" : "bg-indigo-100 border-indigo-300 text-indigo-800"}`}>
                              {cp.irr_recommended}
                            </span>
                            <span className="text-xs text-slate-500">(+{cp.irr_change_pct}%)</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-slate-500 w-20 shrink-0">NPK</span>
                            <span className="text-sm font-mono bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-700">{cp.npk_current} Kg/ha</span>
                            <ArrowRight size={12} className={bothInfeasible ? "text-blue-400 shrink-0" : "text-indigo-400 shrink-0"} />
                            <span className={`text-sm font-mono border rounded px-2 py-0.5 font-bold ${bothInfeasible ? "bg-blue-100 border-blue-300 text-blue-800" : "bg-indigo-100 border-indigo-300 text-indigo-800"}`}>
                              {cp.npk_recommended} Kg/ha
                            </span>
                            <span className="text-xs text-slate-500">(+{cp.npk_change_pct}%)</span>
                          </div>
                        </div>

                        <p className={`text-xs leading-relaxed ${bothInfeasible ? "text-blue-800" : "text-indigo-800"}`}>
                          Applying both adjustments simultaneously projects yield to{" "}
                          <span className="font-semibold">{cp.new_yield.toLocaleString()} Kg/ha</span> —
                          reaching <span className="font-semibold text-emerald-700">Green</span>.{" "}
                          {bothInfeasible
                            ? "This is the minimum-effort combination: each field is raised by the least possible amount to cross the district median together."
                            : "This combined approach may require smaller individual changes than applying either input alone to its maximum."}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-start gap-1.5 pt-2 border-t border-slate-100">
                <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Individual paths: binary search per field independently. Combined path: sweeps irrigation in 25 steps, binary-searches minimum NPK at each — selects the combination with minimum total normalised effort.
                  Target: district median ({data.target_yield.toLocaleString()} Kg/ha).
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MultiYearPanel({ advisory, onPlanData }) {
  const [open, setOpen] = useState(false);
  const [planYears, setPlanYears] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [planError, setPlanError] = useState(null);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !fetched && advisory.crop && advisory.inputs) {
      setLoading(true);
      setPlanError(null);
      try {
        const y1 = advisory.predicted_yield;
        const lag0 = advisory.inputs.YIELD_LAG_1 || 1500;
        const { hist_q25, hist_median } = advisory;
        const classifyLevel = (yld) =>
          yld < hist_q25 ? "red" : yld < hist_median ? "amber" : "green";
        const inp2 = { ...advisory.inputs, YIELD_LAG_1: Math.round(y1), YIELD_LAG_3: lag0 };
        const r2 = await getPrediction(advisory.crop, inp2);
        const y2 = Math.round(r2.predicted_yield);
        const inp3 = { ...advisory.inputs, YIELD_LAG_1: y2, YIELD_LAG_3: Math.round(y1) };
        const r3 = await getPrediction(advisory.crop, inp3);
        const y3 = Math.round(r3.predicted_yield);
        const data = [
          { label: "Year 1", yld: Math.round(y1), level: advisory.level, isBase: true },
          { label: "Year 2", yld: y2, level: classifyLevel(y2) },
          { label: "Year 3", yld: y3, level: classifyLevel(y3) },
        ];
        setPlanYears(data);
        if (onPlanData) onPlanData(data);
      } catch (e) {
        setPlanError("Could not compute multi-year projection.");
        console.error(e);
      } finally {
        setLoading(false);
        setFetched(true);
      }
    }
  }

  const msp = MSP_PER_QUINTAL[advisory.crop];
  const LC = { green: "#10b981", amber: "#f59e0b", red: "#ef4444" };
  const LB = {
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
  };
  const traj = planYears ? (() => {
    const pct = ((planYears[2].yld - planYears[0].yld) / planYears[0].yld) * 100;
    if (pct > 5)  return { label: "Improving", sym: "+", colour: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" };
    if (pct < -5) return { label: "Declining",  sym: "-", colour: "text-red-600",    bg: "bg-red-50 border-red-200" };
    return         { label: "Stable",    sym: "~", colour: "text-amber-600", bg: "bg-amber-50 border-amber-200" };
  })() : null;
  const cd = planYears ? planYears.map(y => ({ name: y.label, yld: y.yld, fill: LC[y.level] || "#6366f1" })) : [];

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <button onClick={handleOpen}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays size={16} className="text-indigo-500 shrink-0" />
          <span className="text-sm font-semibold text-slate-800">3-Year Planning Horizon</span>
          <span className="text-xs text-slate-400">Project yield trajectory over 3 seasons</span>
          {traj && <span className={"text-xs font-bold " + traj.colour}>{traj.sym} {traj.label}</span>}
        </div>
        <ChevronDown size={16} className={"text-slate-400 transition-transform shrink-0 ml-2 " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-slate-100">
          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> Projecting years 2 and 3...
            </div>
          )}
          {planError && <p className="text-xs text-slate-400 py-4 text-center">{planError}</p>}
          {!loading && planYears && (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                Each year uses the <span className="font-medium text-slate-700">prior year projected yield</span> as
                the next season starting point, simulating how yield history momentum compounds forward under constant farming inputs.
              </p>
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Projected yield trajectory</p>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={cd} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barSize={52}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                      tickFormatter={v => v.toLocaleString()} width={60} domain={[0, "auto"]} />
                    <Tooltip formatter={(value) => [value.toLocaleString() + " Kg/ha", "Yield"]}
                      contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                    <ReferenceLine y={advisory.hist_median} stroke="#94a3b8" strokeDasharray="4 2"
                      label={{ value: "Median", position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }} />
                    <Bar dataKey="yld" radius={[4, 4, 0, 0]}>
                      {cd.map((entry, i) => <Cell key={i} fill={entry.fill} fillOpacity={i === 0 ? 1 : 0.72} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left font-semibold">Year</th>
                      <th className="px-3 py-2 text-right font-semibold">Yield (Kg/ha)</th>
                      <th className="px-3 py-2 text-center font-semibold">Level</th>
                      <th className="px-3 py-2 text-right font-semibold">vs Median</th>
                      {msp && <th className="px-3 py-2 text-right font-semibold">Revenue / ha</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {planYears.map((y, i) => {
                      const diff = y.yld - advisory.hist_median;
                      const rev = msp ? Math.round((y.yld / 100) * msp) : null;
                      return (
                        <tr key={i} className={y.isBase ? "bg-slate-50/60" : "bg-white"}>
                          <td className="px-3 py-2.5 font-medium text-slate-700">
                            {y.label}
                            {y.isBase && <span className="ml-1.5 text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full">base</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-800">{y.yld.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full " + (LB[y.level] || "bg-slate-100 text-slate-600")}>{y.level.toUpperCase()}</span>
                          </td>
                          <td className={"px-3 py-2.5 text-right font-medium " + (diff >= 0 ? "text-emerald-600" : "text-red-600")}>
                            {(diff >= 0 ? "+" : "") + diff.toLocaleString()}
                          </td>
                          {msp && <td className="px-3 py-2.5 text-right text-slate-600">{"Rs." + (rev ? rev.toLocaleString("en-IN") : "")}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {traj && (
                <div className={"rounded-lg px-3 py-2.5 border " + traj.bg}>
                  <p className={"text-xs font-semibold mb-1 " + traj.colour}>{traj.sym} {traj.label} trajectory</p>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {traj.label === "Improving"
                      ? "If conditions persist, yield is projected to grow from " + planYears[0].yld.toLocaleString() + " to " + planYears[2].yld.toLocaleString() + " Kg/ha (+" + Math.round(((planYears[2].yld - planYears[0].yld) / planYears[0].yld) * 100) + "%) as positive yield history compounds forward."
                      : traj.label === "Declining"
                      ? "Yield may decline from " + planYears[0].yld.toLocaleString() + " to " + planYears[2].yld.toLocaleString() + " Kg/ha over 3 seasons. A below-average starting yield feeds into future predictions. Use the Upgrade Path above to break this cycle."
                      : "Yield is projected stable around " + planYears[1].yld.toLocaleString() + " Kg/ha. The yield history feedback is not creating a strong trend in either direction under current conditions."
                    }
                  </p>
                </div>
              )}
              {traj?.label === "Declining" && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 flex items-start gap-3">
                  <Zap size={15} className="text-orange-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-orange-800 mb-0.5">Break this cycle with the Upgrade Path</p>
                    <p className="text-[11px] text-orange-700 leading-relaxed">
                      The declining trajectory is driven by a below-average yield feeding into the next season's lag input.
                      The <span className="font-medium">Upgrade Path to Green</span> panel above shows the minimum irrigation
                      and NPK increase needed to lift Year 1 yield — which directly reduces the downward momentum in Years 2 and 3.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-1.5 pt-2 border-t border-slate-100">
                <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Assumes <span className="font-medium text-slate-500">constant farming inputs</span> (irrigation, NPK, weather) across all 3 years. Only YIELD_LAG_1 is updated each year using the prior projection. District median shown as grey dashed line. Model-based trajectory, not a forecast.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function MonteCarloPanel({ advisory, onDataLoaded }) {
  const [open,    setOpen]    = useState(false);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !fetched && advisory.crop && advisory.inputs) {
      setLoading(true);
      try {
        const res = await fetchMonteCarlo(advisory.crop, advisory.inputs, advisory.dist_code);
        setData(res);
        if (onDataLoaded) onDataLoaded(res);
      } catch (e) {
        console.error("Monte Carlo failed", e);
      } finally {
        setLoading(false);
        setFetched(true);
      }
    }
  }

  const rmse = XGB_RMSE[advisory.crop] || 0;
  const lp = data?.level_probabilities || {};
  const nonRedPct = (lp.green || 0) + (lp.amber || 0);
  const isTight = data ? (data.p90 - data.p10) < 20 : false;

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <BarChart3 size={16} className="text-violet-500 shrink-0" />
          <span className="text-sm font-semibold text-slate-800">Weather Uncertainty</span>
          <span className="text-xs text-slate-400">Monte Carlo · 1,000 weather scenarios</span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ml-2 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100">
          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> Running 1,000 simulations…
            </div>
          )}

          {!loading && fetched && !data && (
            <p className="text-xs text-slate-400 py-4 text-center">Monte Carlo analysis unavailable.</p>
          )}

          {!loading && data && (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-slate-500">
                Weather inputs (rainfall, temperature) were randomly varied across 1,000 scenarios to show
                how yield might shift under realistic seasonal variability — holding your farming decisions fixed.
              </p>

              {isTight ? (
                /* ── Tight spread: clean summary layout ── */
                <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-violet-400" />
                    <span className="text-xs font-semibold text-violet-700">
                      Prediction is robust to weather variability
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="text-center">
                      <div className="text-[10px] text-slate-400 mb-0.5">Worst case (P10)</div>
                      <div className="text-lg font-bold text-slate-800">{Math.round(data.p10).toLocaleString()}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-slate-400 mb-0.5">Median (P50)</div>
                      <div className="text-lg font-bold text-violet-700">{Math.round(data.p50).toLocaleString()}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-slate-400 mb-0.5">Best case (P90)</div>
                      <div className="text-lg font-bold text-slate-800">{Math.round(data.p90).toLocaleString()}</div>
                    </div>
                  </div>
                  <p className="text-[11px] text-violet-600 leading-relaxed">
                    Across 1,000 simulated weather scenarios, yield varies by only <span className="font-bold">{Math.round(data.p90 - data.p10)} Kg/ha</span>.
                    This means non-weather factors (irrigation, fertiliser, yield history) dominate — weather
                    uncertainty has minimal impact on this prediction.
                  </p>
                </div>
              ) : (
                /* ── Wide spread: full distribution visualization ── */
                <>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      Yield distribution across simulated seasons
                    </p>

                    {(() => {
                      const lo = data.p10, hi = data.p90;
                      const pad = (hi - lo) * 0.15 || 50;
                      const min = Math.max(0, lo - pad), max = hi + pad;
                      const range = max - min || 1;
                      const pct = (v) => ((v - min) / range) * 100;
                      const q25 = data.hist_q25, med = data.hist_median;
                      const q25Pct = Math.max(0, Math.min(100, pct(q25)));
                      const medPct = Math.max(0, Math.min(100, pct(med)));

                      return (
                        <>
                          <div className="relative h-7 rounded-full bg-slate-100 overflow-hidden">
                            <div className="absolute inset-0 rounded-full overflow-hidden">
                              <div className="absolute h-full bg-red-100" style={{ left: 0, width: `${q25Pct}%` }} />
                              <div className="absolute h-full bg-amber-100" style={{ left: `${q25Pct}%`, width: `${medPct - q25Pct}%` }} />
                              <div className="absolute h-full bg-emerald-100" style={{ left: `${medPct}%`, width: `${100 - medPct}%` }} />
                            </div>
                            <div
                              className="absolute h-full bg-violet-300/50 border-x border-violet-400/60"
                              style={{
                                left:  `${pct(data.p25)}%`,
                                width: `${pct(data.p75) - pct(data.p25)}%`,
                              }}
                            />
                            <div className="absolute top-0 w-0.5 h-full bg-violet-600" style={{ left: `${pct(data.p50)}%` }} />
                            <div
                              className="absolute -top-0.5 flex flex-col items-center"
                              style={{ left: `${pct(advisory.predicted_yield)}%`, transform: "translateX(-50%)" }}>
                              <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-700" />
                            </div>
                            <div className="absolute top-0 w-px h-full bg-red-300/70" style={{ left: `${q25Pct}%` }} />
                            <div className="absolute top-0 w-px h-full bg-slate-400/70" style={{ left: `${medPct}%` }} />
                          </div>

                          <div className="relative h-8 mt-1">
                            {[
                              { val: data.p10, label: "P10", pct: pct(data.p10) },
                              { val: data.p25, label: "P25", pct: pct(data.p25) },
                              { val: data.p50, label: "P50", pct: pct(data.p50) },
                              { val: data.p75, label: "P75", pct: pct(data.p75) },
                              { val: data.p90, label: "P90", pct: pct(data.p90) },
                            ].map(({ val, label, pct: p }) => (
                              <div key={label} className="absolute flex flex-col items-center" style={{ left: `${p}%`, transform: "translateX(-50%)" }}>
                                <span className="text-[10px] font-semibold text-violet-600">{label}</span>
                                <span className="text-[9px] text-slate-500 tabular-nums">{Math.round(val).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </>
              )}

              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Simulated advisory distribution
                </p>
                <div className="flex items-center gap-2">
                  {lp.green > 0 && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                      {lp.green}% Green
                    </span>
                  )}
                  {lp.amber > 0 && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                      {lp.amber}% Amber
                    </span>
                  )}
                  {lp.red > 0 && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                      {lp.red}% Red
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                  <div className="text-sm font-bold text-slate-800">{Math.round(data.p10).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Worst likely</div>
                </div>
                <div className="bg-violet-50 rounded-lg p-2.5 text-center">
                  <div className="text-sm font-bold text-violet-700">{Math.round(data.p50).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Median</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                  <div className="text-sm font-bold text-slate-800">{Math.round(data.p90).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Best likely</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                  <div className="text-sm font-bold text-slate-800">{Math.round(data.iqr).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">IQR spread</div>
                </div>
              </div>

              {!isTight && (
                <div className="bg-violet-50 border border-violet-100 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-violet-800 leading-relaxed">
                    In <span className="font-bold">{nonRedPct}%</span> of simulated weather scenarios,
                    yield is projected to exceed the Q25 threshold ({Math.round(data.hist_q25).toLocaleString()} Kg/ha).
                    The worst likely case (P10) is <span className="font-semibold">{Math.round(data.p10).toLocaleString()} Kg/ha</span>,
                    the best likely case (P90) is <span className="font-semibold">{Math.round(data.p90).toLocaleString()} Kg/ha</span>.
                  </p>
                </div>
              )}

              <div className="flex items-start gap-1.5 pt-2 border-t border-slate-100">
                <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  This quantifies <span className="font-medium text-slate-500">input uncertainty</span> (weather
                  stochasticity) — complementing the ±{rmse.toFixed(0)} Kg/ha <span className="font-medium text-slate-500">model
                  uncertainty</span> band shown above. Weather inputs sampled from
                  N(current, (0.3·σ)²). Non-weather inputs held constant.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
