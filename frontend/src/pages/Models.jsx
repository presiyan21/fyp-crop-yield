import { useState, useEffect } from "react";
import { fetchModelInfo, fetchYieldReports } from "../lib/api";
import { getFeatureLabel, isUserControllable, getConfidenceTier } from "../lib/featureLabels";
import { ShieldCheck, ChevronDown, ChevronUp, Info, BarChart3, ArrowRight, FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const XGB_RESULTS = {
  rice:         { r2: 0.821, rmse: 410.6 },
  wheat:        { r2: 0.813, rmse: 454.8 },
  maize:        { r2: 0.688, rmse: 844.7 },
  sorghum:      { r2: 0.426, rmse: 425.7 },
  pearl_millet: { r2: 0.448, rmse: 465.9 },
  chickpea:     { r2: 0.436, rmse: 266.6 },
  pigeonpea:    { r2: 0.462, rmse: 285.5 },
  groundnut:    { r2: 0.476, rmse: 446.3 },
  cotton:       { r2: 0.424, rmse: 154.7 },
  sugarcane:    { r2: 0.673, rmse: 1556.7 },
};

const COLOUR_MAP = {
  emerald: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  amber:   { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-700",   badge: "bg-amber-100 text-amber-700",   bar: "bg-amber-500" },
  red:     { bg: "bg-red-50",     border: "border-red-200",     text: "text-red-700",     badge: "bg-red-100 text-red-700",       bar: "bg-red-400" },
};

export default function Models() {
  const [info, setInfo] = useState(null);
  const [selected, setSelected] = useState("rice");
  const [showTechnical, setShowTechnical] = useState(false);
  const [liveStats, setLiveStats] = useState(null);
  const { profile } = useAuth();

  useEffect(() => {
    fetchModelInfo().then(setInfo).catch(() => {});
  }, []);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    fetchYieldReports()
      .then(res => {
        const reports = res?.reports || [];
        const classifiable = reports.filter(r => r.actual_level && r.advisory_level);
        const correct = classifiable.filter(r => r.actual_level === r.advisory_level);
        const accuracy = classifiable.length > 0
          ? Math.round((correct.length / classifiable.length) * 100) : null;
        setLiveStats({ total: reports.length, classifiable: classifiable.length, accuracy });
      })
      .catch(() => {});
  }, [profile]);

  if (!info) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="animate-pulse space-y-3 mt-4">
          <div className="h-8 bg-slate-100 rounded w-64" />
          <div className="h-48 bg-slate-100 rounded-xl" />
        </div>
      </div>
    );
  }

  const selectedR2 = XGB_RESULTS[selected]?.r2 || 0;
  const selectedConf = getConfidenceTier(selectedR2);
  const selectedColours = COLOUR_MAP[selectedConf.colour];
  const cropInfo = info[selected];
  const hasShap = cropInfo?.shap_top10 && Object.keys(cropInfo.shap_top10).length > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Model Transparency</h1>
        <p className="text-sm text-slate-500">
          Understand how reliable the predictions are for each crop, and what factors
          the model considers most important.
        </p>
      </div>

      {/* Cross-crop confidence overview */}
      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 size={16} className="text-slate-500" />
          <h2 className="font-medium text-slate-800">Prediction confidence by crop</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          How much of the yield variation the model can explain. Tap a crop to see what drives its predictions.
        </p>

        <div className="space-y-2">
          {Object.entries(XGB_RESULTS)
            .sort(([, a], [, b]) => b.r2 - a.r2)
            .map(([crop, { r2 }]) => {
              const conf = getConfidenceTier(r2);
              const colours = COLOUR_MAP[conf.colour];
              const isSelected = crop === selected;
              return (
                <button
                  key={crop}
                  onClick={() => setSelected(crop)}
                  className={`w-full flex items-center gap-3 rounded-lg p-2 text-left transition
                    ${isSelected ? `${colours.bg} ${colours.border} border` : "hover:bg-slate-50 border border-transparent"}`}
                >
                  <span className="w-28 text-sm font-medium capitalize shrink-0">
                    {crop.replace(/_/g, " ")}
                  </span>
                  <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${colours.bar}`}
                      style={{ width: `${r2 * 100}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${colours.badge}`}>
                    {conf.label}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      {/* Live validation cross-reference — admin only */}
      {liveStats && (
        <div className="flex items-center justify-between gap-4 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
          <div className="flex items-start gap-2.5">
            <FlaskConical size={15} className="text-violet-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-violet-800">
                Live validation · {liveStats.total} user harvest report{liveStats.total !== 1 ? "s" : ""} collected
              </p>
              <p className="text-xs text-violet-700 mt-0.5">
                {liveStats.classifiable > 0
                  ? <>Classification accuracy on real harvest data: <strong>{liveStats.accuracy}%</strong> ({liveStats.classifiable} classifiable reports) — compares the model's advisory level against what farmers actually harvested.</>
                  : "No classifiable reports yet — report a harvest on the History page to begin live validation."}
              </p>
            </div>
          </div>
          {liveStats.classifiable > 0 && (
            <Link to="/admin"
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-violet-800 bg-violet-100 hover:bg-violet-200 border border-violet-300 px-3 py-1.5 rounded-lg transition whitespace-nowrap">
              Confusion matrix <ArrowRight size={12} />
            </Link>
          )}
        </div>
      )}

      {/* Feature category breakdown */}
      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Info size={16} className="text-slate-500" />
          <h2 className="font-medium text-slate-800">What the model knows — 6 feature domains</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Each crop model uses 58–59 features encoding six distinct knowledge domains. This is not arbitrary feature selection — each domain captures a different causal pathway to yield.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              name: "Temporal / Lag",
              count: 12,
              colour: "bg-indigo-50 border-indigo-200 text-indigo-700",
              dot: "bg-indigo-400",
              desc: "Prior season yield lags (1, 3, 5 years), long-term technology trend, and yield momentum signals. Captures agricultural autocorrelation — a bad year predicts a harder next year.",
              why: "Strongest predictor group — top SHAP features for most crops.",
            },
            {
              name: "Climate",
              count: 15,
              colour: "bg-sky-50 border-sky-200 text-sky-700",
              dot: "bg-sky-400",
              desc: "Annual rainfall, Kharif max temperature, Rabi min temperature, season-specific rainfall indices, and rainfall deviation from historical baseline.",
              why: "Live weather auto-fill connects real Open-Meteo data to these features.",
            },
            {
              name: "Irrigation",
              count: 8,
              colour: "bg-cyan-50 border-cyan-200 text-cyan-700",
              dot: "bg-cyan-500",
              desc: "Irrigation coverage ratio, net irrigated area, gross irrigated area, canal vs groundwater source split, and irrigated area trends over time.",
              why: "User-controllable. Irrigation ratio is the key input in the Upgrade Path.",
            },
            {
              name: "Fertilizer",
              count: 10,
              colour: "bg-emerald-50 border-emerald-200 text-emerald-700",
              dot: "bg-emerald-400",
              desc: "Total NPK (Kg/ha), individual N, P, K components, fertilizer-to-area ratio, NPK trend, and fertilizer×irrigation interaction term capturing synergistic effects.",
              why: "User-controllable. NPK total is the second binary-searched field in Upgrade Path.",
            },
            {
              name: "Land Use",
              count: 8,
              colour: "bg-amber-50 border-amber-200 text-amber-700",
              dot: "bg-amber-400",
              desc: "Gross cropped area, net sown area, area under the specific crop, crop area share of total agricultural land, and multi-year area trend.",
              why: "Captures district-level agricultural intensity and crop specialisation.",
            },
            {
              name: "Market",
              count: 5,
              colour: "bg-rose-50 border-rose-200 text-rose-700",
              dot: "bg-rose-400",
              desc: "Minimum Support Price (MSP) at time of planting, real MSP growth rate, and crop price index — encoding the economic incentive signal farmers respond to.",
              why: "Policy signal. Rising MSP shifts area allocation and input intensity.",
            },
          ].map(({ name, count, colour, dot, desc, why }) => (
            <div key={name} className={`rounded-xl border p-4 ${colour}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
                  <span className="text-xs font-bold">{name}</span>
                </div>
                <span className="text-xs font-bold opacity-70">{count} features</span>
              </div>
              <p className="text-[11px] leading-relaxed opacity-80 mb-2">{desc}</p>
              <p className="text-[10px] font-semibold opacity-60 flex items-start gap-1">
                <span className="shrink-0">→</span>{why}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 pt-3 border-t border-slate-100">
          <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Feature engineering followed agronomic literature — lag features encode the well-documented yield autocorrelation in Indian agriculture (Birthal et al., 2014). The fertilizer×irrigation interaction term captures complementarity confirmed in field trials. All 58–59 features were selected via SHAP-based importance screening across the full 311-district, 40-year training set.
          </p>
        </div>
      </div>

      {/* Selected crop detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Confidence explanation */}
        <div className={`rounded-xl border p-5 ${selectedColours.bg} ${selectedColours.border}`}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={18} className={selectedColours.text} />
            <h3 className="font-medium capitalize">
              {selected.replace(/_/g, " ")} — {selectedConf.label}
            </h3>
          </div>
          <p className="text-sm text-slate-700 mb-3">
            {selectedConf.description}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/70 rounded-lg p-3">
              <div className="text-xs text-slate-500">Accuracy score</div>
              <div className="text-lg font-semibold text-slate-800">
                {(selectedR2 * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                of yield variation explained
              </div>
            </div>
            <div className="bg-white/70 rounded-lg p-3">
              <div className="text-xs text-slate-500">Typical error</div>
              <div className="text-lg font-semibold text-slate-800">
                ±{XGB_RESULTS[selected]?.rmse.toFixed(0)} Kg/ha
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                average prediction deviation
              </div>
            </div>
          </div>
          <Link
            to={`/?crop=${selected}`}
            className="mt-3 flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-white/70 border border-current/20 text-sm font-medium hover:bg-white transition"
          >
            Predict {selected.replace(/_/g, " ")} <ArrowRight size={14} />
          </Link>
        </div>

        {/* SHAP importance */}
        <div className="bg-white border rounded-xl p-5">
          <h3 className="font-medium mb-1">
            What drives <span className="capitalize">{selected.replace(/_/g, " ")}</span> predictions?
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Top factors by influence. <span className="text-blue-500">Blue</span> = you control this input on the Dashboard.
          </p>
          {hasShap ? (
            <div className="space-y-2">
              {Object.entries(cropInfo.shap_top10)
                .sort(([, a], [, b]) => b - a)
                .map(([feature, value]) => {
                  const maxVal = Math.max(...Object.values(cropInfo.shap_top10));
                  const pct = (value / maxVal) * 100;
                  const controllable = isUserControllable(feature);
                  return (
                    <div key={feature} className="flex items-center gap-2">
                      <div className="w-36 shrink-0" title={feature}>
                        <div className="text-xs text-slate-700 font-medium truncate">
                          {getFeatureLabel(feature)}
                        </div>
                        {controllable && (
                          <div className="text-[10px] text-blue-500 font-medium">Your input</div>
                        )}
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-500 ${
                            controllable ? "bg-blue-500" : "bg-slate-400"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-xs text-right text-slate-500 tabular-nums shrink-0">
                        {value.toFixed(0)}
                      </span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="text-slate-400 text-sm">No data available.</div>
          )}
        </div>
      </div>

      {/* Technical details (expandable) */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowTechnical(!showTechnical)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition"
        >
          <span className="text-sm font-medium text-slate-700">Full performance results</span>
          {showTechnical ? (
            <ChevronUp size={16} className="text-slate-400" />
          ) : (
            <ChevronDown size={16} className="text-slate-400" />
          )}
        </button>

        {showTechnical && (
          <div className="border-t">
            <div className="px-5 py-3 border-b bg-slate-50">
              <p className="text-xs text-slate-500">
                XGBoost R² and RMSE on held-out temporal test set (2006–2015).
                Trained on data ≤ 2005. No temporal leakage.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">Crop</th>
                    <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">R²</th>
                    <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">RMSE (Kg/ha)</th>
                    <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">Features</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(XGB_RESULTS).map(([crop, { r2, rmse }]) => {
                    const conf = getConfidenceTier(r2);
                    const colours = COLOUR_MAP[conf.colour];
                    return (
                      <tr key={crop} className="hover:bg-slate-50">
                        <td className="px-5 py-2.5 font-medium capitalize">{crop.replace(/_/g, " ")}</td>
                        <td className="px-5 py-2.5 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colours.badge}`}>
                            {r2.toFixed(3)}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right text-slate-600">{rmse.toFixed(1)}</td>
                        <td className="px-5 py-2.5 text-right text-slate-500">
                          {info[crop]?.feature_count ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>


    </div>
  );
}
