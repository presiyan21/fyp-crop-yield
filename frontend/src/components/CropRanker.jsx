import { useState } from "react";
import { rankCrops } from "../lib/api";
import { Loader2, Trophy, TrendingUp, TrendingDown, Zap, ChevronRight, RefreshCw } from "lucide-react";
import { getConfidenceTier } from "../lib/featureLabels";

const LEVEL_COLORS = {
  green: { bg: "bg-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500" },
  amber: { bg: "bg-amber-100",   text: "text-amber-700",   bar: "bg-amber-400"   },
  red:   { bg: "bg-red-100",     text: "text-red-600",     bar: "bg-red-400"     },
};

const MODEL_R2 = {
  rice: 0.821, wheat: 0.813, maize: 0.688, sugarcane: 0.673,
  pigeonpea: 0.462, groundnut: 0.476, pearl_millet: 0.448,
  chickpea: 0.436, sorghum: 0.426, cotton: 0.424,
};

export default function CropRanker({ distCode, districtName, features, onCropSelect }) {
  const [results,  setResults]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [sortMode, setSortMode] = useState("relative"); // "relative" | "yield"

  async function handleRank() {
    setLoading(true);
    setError(null);
    try {
      const data = await rankCrops(features, distCode || null);
      setResults(data.ranked);
    } catch {
      setError("Failed to rank crops — make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  const sorted = results
    ? [...results].sort((a, b) =>
        sortMode === "yield" ? b.predicted_yield - a.predicted_yield : b.delta_pct - a.delta_pct
      )
    : null;

  const maxYield = sorted ? Math.max(...sorted.map(x => x.predicted_yield)) : 1;

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-4 border-b">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={14} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-800">Crop Ranker</h2>
          {results && (
            <span className="ml-auto text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {results.length} crops analysed
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Runs all 10 models with your current inputs to find which crop performs best
          for your specific conditions
          {districtName && <span className="font-medium text-slate-600"> in {districtName}</span>}.
        </p>

        {!results && !loading && (
          <button onClick={handleRank}
            className="mt-3 w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg
                       text-sm font-medium flex items-center justify-center gap-2 transition">
            <Zap size={14} />
            Rank All Crops for My Inputs
          </button>
        )}

        {loading && (
          <div className="mt-3 flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-amber-500" />
            Running 10 models…
          </div>
        )}

        {results && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs text-slate-400">Sort by</span>
            {[
              { key: "relative", label: "Best vs district median" },
              { key: "yield",    label: "Highest raw yield" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setSortMode(key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  sortMode === key
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}>
                {label}
              </button>
            ))}
            <button onClick={() => { setResults(null); setError(null); }}
              className="ml-auto text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
              <RefreshCw size={10} /> Re-run
            </button>
          </div>
        )}
      </div>

      {error && <div className="p-4 text-sm text-red-600 bg-red-50">{error}</div>}

      {/* Ranked list */}
      {sorted && (
        <>
          <div className="divide-y">
            {sorted.map((item, idx) => {
              const colors  = LEVEL_COLORS[item.level] || LEVEL_COLORS.amber;
              const r2      = MODEL_R2[item.crop] || 0.5;
              const conf    = getConfidenceTier(r2);
              const label   = item.crop.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
              const barPct  = Math.round((item.predicted_yield / maxYield) * 100);
              const isBest  = idx === 0;

              return (
                <div key={item.crop}
                  className={`px-4 py-3 transition ${isBest ? "bg-amber-50/50" : "hover:bg-slate-50/60"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`text-[11px] font-bold w-6 h-6 rounded-full flex items-center
                                      justify-center flex-shrink-0 mt-0.5 ${
                      idx === 0 ? "bg-amber-100 text-amber-700" :
                      idx === 1 ? "bg-slate-200 text-slate-500" :
                      idx === 2 ? "bg-orange-50 text-orange-500" :
                                 "bg-gray-100 text-gray-400"
                    }`}>
                      {idx + 1}
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* Top row: name + badges */}
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <span className="text-sm font-medium text-slate-800">{label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${colors.bg} ${colors.text}`}>
                          {item.level}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          conf.colour === "emerald" ? "bg-emerald-50 text-emerald-600" :
                          conf.colour === "amber"   ? "bg-amber-50 text-amber-600"   :
                                                      "bg-red-50 text-red-500"
                        }`}>
                          {conf.label}
                        </span>
                        {isBest && (
                          <span className="ml-auto text-[10px] text-amber-600 font-semibold flex items-center gap-1">
                            <Trophy size={9} /> Best fit
                          </span>
                        )}
                      </div>

                      <div className="h-1.5 bg-slate-100 rounded-full mb-1.5 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
                          style={{ width: `${barPct}%` }} />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-mono font-medium text-slate-700">
                            {item.predicted_yield.toLocaleString()} Kg/ha
                          </span>
                          <span className={`flex items-center gap-0.5 font-medium ${
                            item.delta >= 0 ? "text-emerald-600" : "text-red-500"
                          }`}>
                            {item.delta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            {item.delta >= 0 ? "+" : ""}{item.delta_pct.toFixed(1)}% vs median
                          </span>
                          <span className="text-slate-400 text-[10px]">
                            median {item.hist_median.toLocaleString()}
                          </span>
                        </div>
                        <button onClick={() => onCropSelect(item.crop)}
                          className="flex items-center gap-0.5 text-[11px] text-blue-600
                                     hover:text-blue-800 font-medium transition shrink-0">
                          Select <ChevronRight size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-4 py-3 bg-slate-50 border-t">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Rankings use your current inputs (yield lag, irrigation, NPK, rainfall, temperatures).
              "Best vs district median" normalises across crops — recommended for crop selection.
              Model confidence varies: higher-confidence crops give more reliable predictions.
              Click <span className="font-medium">Select</span> to switch crop, then run a full advisory.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
