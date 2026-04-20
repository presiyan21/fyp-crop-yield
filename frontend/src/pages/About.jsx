import { Database, Brain, BarChart2, AlertTriangle, FlaskConical, Layers, Info, GitMerge, TrendingUp, CalendarDays } from "lucide-react";

const MODEL_PERFORMANCE = [
  { crop: "Rice",         r2: 0.821, rmse: 410.6,  tier: "high"   },
  { crop: "Wheat",        r2: 0.813, rmse: 454.8,  tier: "high"   },
  { crop: "Sugarcane",    r2: 0.673, rmse: 1556.7, tier: "medium" },
  { crop: "Maize",        r2: 0.688, rmse: 844.7,  tier: "medium" },
  { crop: "Pigeonpea",    r2: 0.462, rmse: 285.5,  tier: "low"    },
  { crop: "Groundnut",    r2: 0.476, rmse: 446.3,  tier: "low"    },
  { crop: "Pearl Millet", r2: 0.448, rmse: 465.9,  tier: "low"    },
  { crop: "Chickpea",     r2: 0.436, rmse: 266.6,  tier: "low"    },
  { crop: "Sorghum",      r2: 0.426, rmse: 425.7,  tier: "low"    },
  { crop: "Cotton",       r2: 0.424, rmse: 154.7,  tier: "low"    },
];

const FEATURE_GROUPS = [
  { label: "Temporal / Yield Lag", count: 4,  desc: "Previous 1–3 year yields, decade indicator, and long-run trend. Encodes agronomic inertia and capital reinvestment cycles.", colour: "bg-blue-100 text-blue-700" },
  { label: "Climate",              count: 14, desc: "Seasonal rainfall, deviation from normal, temperature extremes (Kharif/Rabi), heat and cold stress days.", colour: "bg-sky-100 text-sky-700" },
  { label: "Irrigation",           count: 7,  desc: "Irrigation ratio, canal and tube-well area, total wells, canal-to-well ratio, water intensity index.", colour: "bg-cyan-100 text-cyan-700" },
  { label: "Fertilizer & Soil",    count: 10, desc: "N/P/K application rates, NPK total, seasonal tonnage, and 13 soil-type binary indicators (Vertisols, Inceptisols, etc.).", colour: "bg-emerald-100 text-emerald-700" },
  { label: "Land Use",             count: 8,  desc: "Net/gross sown and cropped area, cropping intensity index, net crop ratio.", colour: "bg-amber-100 text-amber-700" },
  { label: "Market",               count: 2,  desc: "3-year rolling state-level price trend. Proxies profitability incentives influencing farmer investment decisions.", colour: "bg-rose-100 text-rose-700" },
];

const LIMITATIONS = [
  {
    issue: "Pulse crop predictability",
    detail: "Chickpea, sorghum, cotton, and pearl millet achieve R² of 0.42–0.48. Higher micro-climate sensitivity not captured in district-level averages explains the gap.",
  },
  {
    issue: "Data currency — partially mitigated",
    detail: "Training data runs to 2015. Four active mitigation layers: (1) Live Open-Meteo weather auto-fills current climate inputs; (2) a district-specific 10-year baseline replaces the national mean for climate context; (3) OOD warnings flag any user input exceeding 2.5σ from the training distribution; (4) Season Outlook z-scores current conditions against the crop’s own training era. Empirical impact is visible in the Admin confusion matrix: zero Red advisories issued, yet 3 of 8 reported harvests were Red — systematic optimistic bias consistent with extrapolating beyond the 2015 training horizon.",
  },
  {
    issue: "Spatial resolution",
    detail: "All features are district-level aggregates across 311 districts. Sub-district variation in soil quality, micro-climate, and irrigation access is averaged out.",
  },
  {
    issue: "Causal vs predictive",
    detail: "SHAP values show predictive association, not causal effect. High irrigation SHAP importance reflects correlation with productive districts, not a controlled intervention estimate.",
  },
];

function TierBadge({ tier }) {
  if (tier === "high")   return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">High confidence</span>;
  if (tier === "medium") return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Medium confidence</span>;
  return                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Lower confidence</span>;
}

function R2Bar({ value }) {
  const pct = value * 100;
  const colour = value >= 0.7 ? "bg-emerald-500" : value >= 0.55 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-600 w-10 text-right">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

function Section({ icon, title, children, accent = "text-emerald-600" }) {
  const Icon = icon;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={18} className={accent} />
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function About() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">

      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 text-white">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-emerald-500/20 rounded-xl">
            <Brain size={28} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-1">CropAdvisor — Methodology & Data</h1>
            <p className="text-slate-300 text-sm leading-relaxed max-w-2xl">
              A machine learning advisory system for Indian district-level crop yield prediction,
              built on 50 years of ICRISAT agricultural data across 311 districts and 10 major crops.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              {[
                ["311 districts", "bg-white/10"],
                ["10 crops", "bg-white/10"],
                ["1966 – 2015", "bg-white/10"],
                ["58–59 features / crop", "bg-white/10"],
              ].map(([label, cls]) => (
                <span key={label} className={`text-xs px-3 py-1 rounded-full text-white/90 ${cls}`}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Data Source */}
      <Section icon={Database} title="Data Source — ICRISAT District-Level Database">
        <p className="text-sm text-slate-600 leading-relaxed">
          All training data originates from the{" "}
          <a href="http://data.icrisat.org/dld/src/crops.html"
             target="_blank" rel="noopener noreferrer"
             className="text-blue-600 underline hover:text-blue-700">
            ICRISAT District-Level Database
          </a>
          , maintained by the International Crops Research Institute for the Semi-Arid Tropics.
          It covers 311 Indian districts across 20 states with annual observations from 1966 to 2015,
          providing crop yield, area, and production statistics alongside matched district-level climate,
          irrigation, soil classification, and fertilizer records.
        </p>
      </Section>

      {/* Feature Groups */}
      <Section icon={BarChart2} title="Feature Engineering — 58–59 Features per Crop">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURE_GROUPS.map(g => (
            <div key={g.label} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${g.colour}`}>
                  {g.count} features
                </span>
                <span className="text-xs font-medium text-slate-700">{g.label}</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{g.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3 border-t border-slate-100 pt-3">
          YIELD_LAG_1 and YIELD_LAG_3 consistently rank in the top-2 SHAP positions across most crops.
        </p>
      </Section>

      {/* Model Performance */}
      <Section icon={BarChart2} title="Model Performance — XGBoost on 2006–2015 Test Set">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100">
                <th className="text-left pb-2 pr-4 font-medium">Crop</th>
                <th className="text-left pb-2 pr-4 font-medium w-48">R² (variance explained)</th>
                <th className="text-left pb-2 pr-4 font-medium">RMSE (Kg/ha)</th>
                <th className="text-left pb-2 font-medium">Confidence tier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {MODEL_PERFORMANCE.map(m => (
                <tr key={m.crop} className="hover:bg-slate-50/50">
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{m.crop}</td>
                  <td className="py-2.5 pr-4 w-48"><R2Bar value={m.r2} /></td>
                  <td className="py-2.5 pr-4 text-slate-600 font-mono text-xs tabular-nums">
                    ±{m.rmse.toLocaleString()}
                  </td>
                  <td className="py-2.5"><TierBadge tier={m.tier} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-3 border-t border-slate-100 pt-3">
            Trained on data ≤ 2005. No temporal leakage. All metrics are out-of-sample.
          </p>
        </div>
      </Section>

      {/* Uncertainty Quantification */}
      <Section icon={Layers} title="Uncertainty Quantification" accent="text-violet-600">
        <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-slate-100 rounded-lg p-4 bg-slate-50">
              <p className="font-medium text-slate-800 mb-1.5">Conformal prediction interval</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                The confidence range uses split conformal prediction (Angelopoulos &amp; Bates, 2022)
                calibrated on 2,000–2,800 held-out residuals per crop, giving a 90% marginal
                coverage guarantee. The interval is intentionally wider than ±RMSE — honest
                90% coverage requires a wider band than one standard deviation.
              </p>
            </div>
            <div className="border border-violet-100 rounded-lg p-4 bg-violet-50">
              <p className="font-medium text-slate-800 mb-1.5">Monte Carlo weather uncertainty</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                1,000 inferences run with weather drawn from N(current, (0.3σ)²), producing
                a P10–P90 yield range and per-level probabilities. A tight IQR signals
                non-weather factors dominate; a wide range signals weather-sensitive conditions.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 pt-1">
            <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-400 leading-relaxed">
              SHAP values show predictive association, not causal effect. Harvest yield reports
              feed a CUSUM drift detector and ADF stationarity test per crop, visible in the
              Admin analytics page.
            </p>
          </div>
        </div>
      </Section>

      {/* Limitations */}
      <Section icon={AlertTriangle} title="Limitations & Caveats" accent="text-red-500">
        <div className="space-y-3">
          {LIMITATIONS.map(l => (
            <div key={l.issue} className="flex gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">{l.issue}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{l.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  );
}
