import { useState } from "react";
import { fetchRiskCompare } from "../lib/api";
import { Loader2, Shield, TrendingUp, TrendingDown, AlertTriangle, ChevronRight, IndianRupee, Info } from "lucide-react";

const LEVEL_COLORS = {
  green: { bg: "bg-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500" },
  amber: { bg: "bg-amber-100",   text: "text-amber-700",   bar: "bg-amber-400" },
  red:   { bg: "bg-red-100",     text: "text-red-600",     bar: "bg-red-400" },
};

const fmt = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function RiskCompare({ distCode, districtName, features, onCropSelect }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [sortBy,  setSortBy]  = useState("risk_adjusted");

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRiskCompare(features, distCode || null);
      setResults(data.crops);
    } catch {
      setError("Failed to run risk comparison — check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  const sorted = results
    ? [...results].sort((a, b) => {
        if (sortBy === "expected_revenue") return b.expected_revenue - a.expected_revenue;
        if (sortBy === "worst_revenue")    return b.worst_revenue - a.worst_revenue;
        if (sortBy === "red_probability")  return a.red_probability - b.red_probability;
        return b.risk_adjusted - a.risk_adjusted;
      })
    : null;

  const maxRevenue = sorted ? Math.max(...sorted.map(x => x.expected_revenue)) : 1;
  const hasAnyRisk = sorted ? sorted.some(c => c.red_probability > 0) : false;

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-4 border-b">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={14} className="text-violet-500" />
          <h2 className="text-sm font-semibold text-slate-800">Risk-Adjusted Crop Comparison</h2>
          {results && (
            <span className="ml-auto text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {results.length} crops · 500 MC simulations each
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Combines yield prediction, MSP revenue, and Monte Carlo weather risk to find the best crop
          for your conditions
          {districtName && <span className="font-medium text-slate-600"> in {districtName}</span>}.
        </p>

        {!results && !loading && (
          <button onClick={handleRun}
            className="mt-3 w-full py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg
                       text-sm font-medium flex items-center justify-center gap-2 transition">
            <Shield size={14} />
            Compare All Crops Under Weather Risk
          </button>
        )}

        {loading && (
          <div className="mt-3 flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-violet-500" />
            Running 5,000 simulations (10 crops × 500)…
          </div>
        )}

        {results && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs text-slate-400">Sort by</span>
            {[
              { key: "risk_adjusted",    label: "Risk-adjusted return" },
              { key: "expected_revenue", label: "Expected revenue" },
              { key: "worst_revenue",    label: "Safest worst case" },
              ...(hasAnyRisk ? [{ key: "red_probability", label: "Lowest risk" }] : []),
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setSortBy(key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  sortBy === key
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="p-4 text-sm text-red-600 bg-red-50">{error}</div>}

      {sorted && (
        <>
          <div className="divide-y">
            {sorted.map((item, idx) => {
              const colors  = LEVEL_COLORS[item.level] || LEVEL_COLORS.amber;
              const barPct  = Math.round((item.expected_revenue / maxRevenue) * 100);
              const isBest  = idx === 0;
              const label   = item.crop.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
              const yieldDelta = item.predicted_yield - item.hist_median;
              const deltaSign  = yieldDelta >= 0 ? "+" : "";

              return (
                <div key={item.crop}
                  className={`px-4 py-3 transition ${isBest ? "bg-violet-50/50" : "hover:bg-slate-50/60"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`text-[11px] font-bold w-6 h-6 rounded-full flex items-center
                                      justify-center flex-shrink-0 mt-0.5 ${
                      idx === 0 ? "bg-violet-100 text-violet-700" :
                      idx === 1 ? "bg-slate-200 text-slate-500" :
                      idx === 2 ? "bg-slate-100 text-slate-400" :
                                 "bg-gray-50 text-gray-400"
                    }`}>
                      {idx + 1}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="text-sm font-medium text-slate-800">{label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${colors.bg} ${colors.text}`}>
                          {item.level}
                        </span>
                        {item.red_probability > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium flex items-center gap-0.5">
                            <AlertTriangle size={8} />
                            {item.red_probability}% risk
                          </span>
                        )}
                        {isBest && (
                          <span className="ml-auto text-[10px] text-violet-600 font-semibold flex items-center gap-1">
                            <Shield size={9} /> Best risk-adjusted
                          </span>
                        )}
                      </div>

                      <div className="h-1.5 bg-slate-100 rounded-full mb-2 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700 bg-violet-400"
                          style={{ width: `${barPct}%` }} />
                      </div>

                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <span className="font-semibold text-slate-700 flex items-center gap-0.5">
                          <IndianRupee size={10} className="text-slate-400" />
                          {fmt(item.expected_revenue)}/ha
                        </span>
                        <span className="text-slate-400">
                          worst {fmt(item.worst_revenue)}
                        </span>
                        <span className={`flex items-center gap-0.5 font-medium ${
                          yieldDelta >= 0 ? "text-emerald-600" : "text-red-500"
                        }`}>
                          {yieldDelta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {deltaSign}{yieldDelta.toFixed(0)} Kg/ha vs median
                        </span>
                        <button onClick={() => onCropSelect(item.crop)}
                          className="ml-auto flex items-center gap-0.5 text-[11px] text-blue-600
                                     hover:text-blue-800 font-medium transition shrink-0">
                          Advisory <ChevronRight size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-4 py-3 bg-slate-50 border-t">
            <div className="flex items-start gap-1.5">
              <Info size={11} className="text-slate-300 mt-0.5 shrink-0" />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Revenue based on 2024–25 GoI Minimum Support Prices. Risk-adjusted score =
                expected revenue × (1 − red probability) — penalises crops with downside risk.
                Worst case is P10 revenue from 500 Monte Carlo weather simulations per crop.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
