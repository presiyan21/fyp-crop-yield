import { CheckCircle, AlertCircle, AlertTriangle, ArrowRight, X, TrendingUp, Lightbulb, Info } from "lucide-react";

const LEVEL_ORDER = { red: 0, amber: 1, green: 2 };
const LEVEL_BADGE = {
  red:   "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  green: "bg-emerald-100 text-emerald-700",
};
const LEVEL_ICON = {
  red:   <AlertTriangle size={16} className="text-red-500" />,
  amber: <AlertCircle  size={16} className="text-amber-500" />,
  green: <CheckCircle  size={16} className="text-emerald-500" />,
};

const INPUT_LABELS = {
  YIELD_LAG_1:                     "Last year's yield (Kg/ha)",
  IRRIGATION_RATIO:                "Irrigation ratio",
  NPK_TOTAL_KG_PER_HA:             "NPK fertilizer (Kg/ha)",
  "ANNUAL RAINFALL (Millimeters)": "Annual rainfall (mm)",
  KHARIF_TMAX:                     "Kharif max temp (°C)",
  RABI_TMIN:                       "Rabi min temp (°C)",
};

function levelDelta(a, b) {
  const diff = LEVEL_ORDER[b] - LEVEL_ORDER[a];
  if (diff > 0) return { label: "Improved", colour: "text-emerald-600" };
  if (diff < 0) return { label: "Worsened", colour: "text-red-600" };
  return { label: "Unchanged", colour: "text-slate-500" };
}

/** Build feature -> {rank, value} from shap_top10, sorted by importance */
function buildShapRanks(shapTop10) {
  if (!shapTop10 || !Object.keys(shapTop10).length) return {};
  return Object.entries(shapTop10)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [feature, value], idx) => {
      acc[feature] = { rank: idx + 1, value };
      return acc;
    }, {});
}

function formatChange(valA, valB) {
  const change = valB - valA;
  const sign = change >= 0 ? "+" : "";
  const formatted = Number.isInteger(change) ? change : change.toFixed(2);
  return `${sign}${formatted}`;
}

export default function ScenarioComparison({ scenarioA, scenarioB, onClear }) {
  if (!scenarioA || !scenarioB) return null;

  const yieldDelta = scenarioB.advisory.predicted_yield - scenarioA.advisory.predicted_yield;
  const yieldPct = scenarioA.advisory.predicted_yield
    ? ((yieldDelta / scenarioA.advisory.predicted_yield) * 100).toFixed(1)
    : 0;
  const levelChange = levelDelta(scenarioA.advisory.level, scenarioB.advisory.level);

  const changedInputs = Object.keys(INPUT_LABELS).filter(
    key => (scenarioA.inputs[key] ?? 0) !== (scenarioB.inputs[key] ?? 0)
  );

  // SHAP ranks from Scenario A (the baseline model)
  const shapRanks = buildShapRanks(scenarioA.advisory.shap_top10);

  // Changed inputs that appear in SHAP top 10, sorted most important first
  const shapLinkedChanges = changedInputs
    .filter(key => shapRanks[key])
    .sort((a, b) => shapRanks[a].rank - shapRanks[b].rank);

  // Conformal interval overlap — does the yield difference survive model uncertainty?
  const ciA = scenarioA.advisory.conformal_interval;
  const ciB = scenarioB.advisory.conformal_interval;
  const _lowA  = ciA ? Math.max(0, ciA.lower_90) : null;
  const _highA = ciA ? ciA.upper_90 : null;
  const _lowB  = ciB ? Math.max(0, ciB.lower_90) : null;
  const _highB = ciB ? ciB.upper_90 : null;
  const intervalsOverlap =
    _lowA !== null && _highA !== null && _lowB !== null && _highB !== null
      ? _lowB < _highA && _lowA < _highB
      : null;

  return (
    <div className="mt-8 border-t pt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-800">Scenario Comparison</h2>
        <button onClick={onClear}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition">
          <X size={14} /> Clear
        </button>
      </div>

      {/* Side-by-side outcome cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {[
          { label: "Scenario A", scenario: scenarioA },
          { label: "Scenario B", scenario: scenarioB },
        ].map(({ label, scenario }) => {
          const medDelta = scenario.advisory.predicted_yield - scenario.advisory.hist_median;
          const medSign = medDelta >= 0 ? "+" : "";
          const medCol = medDelta >= 0 ? "text-emerald-600" : "text-red-600";
          return (
            <div key={label} className="bg-white border rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">{label}</div>
              <div className="flex items-center gap-2 mb-2">
                {LEVEL_ICON[scenario.advisory.level]}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEVEL_BADGE[scenario.advisory.level]}`}>
                  {scenario.advisory.level.toUpperCase()}
                </span>
              </div>
              <div className="text-xl font-bold text-slate-800">
                {scenario.advisory.predicted_yield.toLocaleString()}
                <span className="text-sm font-normal text-slate-400 ml-1">Kg/ha</span>
              </div>
              <div className={`text-xs font-medium mt-0.5 ${medCol}`}>
                {medSign}{medDelta.toFixed(0)} vs district median
              </div>
              {scenario.advisory.conformal_interval && (
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  {Math.max(0, scenario.advisory.conformal_interval.lower_90).toFixed(0)}
                  &ndash;
                  {scenario.advisory.conformal_interval.upper_90.toFixed(0)}
                  <span className="font-sans">&nbsp;Kg/ha &middot; 90% interval</span>
                </div>
              )}
              <div className="text-xs text-slate-400 mt-1 capitalize">
                {scenario.crop.replace(/_/g, " ")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Delta summary */}
      <div className="bg-slate-50 border rounded-xl p-4 mb-4">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Outcome delta</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500">Yield change: </span>
            <span className={`font-semibold ${yieldDelta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {yieldDelta >= 0 ? "+" : ""}{yieldDelta.toFixed(1)} Kg/ha
            </span>
            <span className="text-xs text-slate-400 ml-1">
              ({yieldDelta >= 0 ? "+" : ""}{yieldPct}%)
            </span>
          </div>
          <div>
            <span className="text-slate-500">Advisory: </span>
            <span className={`font-semibold ${levelChange.colour}`}>{levelChange.label}</span>
          </div>
          <div>
            <span className="text-slate-500">vs median A: </span>
            <span className="font-medium">
              {(scenarioA.advisory.predicted_yield - scenarioA.advisory.hist_median).toFixed(0)} Kg/ha
            </span>
          </div>
          <div>
            <span className="text-slate-500">vs median B: </span>
            <span className="font-medium">
              {(scenarioB.advisory.predicted_yield - scenarioB.advisory.hist_median).toFixed(0)} Kg/ha
            </span>
          </div>
          {intervalsOverlap !== null && (
            <div className="col-span-2 pt-2 border-t border-slate-200 mt-1 text-xs">
              <span className="text-slate-500">90% interval overlap: </span>
              {intervalsOverlap ? (
                <span className="text-amber-600 font-medium">
                  Overlapping &mdash; yield difference may not be reliable at 90% confidence
                </span>
              ) : (
                <span className="text-emerald-600 font-medium">
                  Non-overlapping &mdash; yield difference is statistically robust
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Changed parameters with SHAP impact badges */}
      {changedInputs.length > 0 && (
        <div className="bg-white border rounded-xl p-4 mb-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Parameters changed (A &rarr; B)
          </div>
          <div className="space-y-2.5">
            {changedInputs.map(key => {
              const shap = shapRanks[key];
              const valA = scenarioA.inputs[key];
              const valB = scenarioB.inputs[key];
              return (
                <div key={key} className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-slate-500 w-44 shrink-0 truncate text-xs">{INPUT_LABELS[key]}</span>
                  <span className="font-medium text-slate-700 tabular-nums">{valA}</span>
                  <ArrowRight size={13} className="text-slate-300 shrink-0" />
                  <span className="font-medium text-blue-700 tabular-nums">{valB}</span>
                  {shap ? (
                    <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full
                      flex items-center gap-1 shrink-0 ${
                        shap.rank <= 3
                          ? "bg-amber-100 text-amber-700"
                          : shap.rank <= 6
                            ? "bg-slate-100 text-slate-600"
                            : "bg-slate-50 text-slate-500"
                      }`}>
                      <TrendingUp size={9} />
                      #{shap.rank} driver &middot; {shap.value.toFixed(0)} avg influence
                    </span>
                  ) : (
                    <span className="ml-auto text-[10px] text-slate-300 shrink-0">
                      not in top 10 drivers
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {shapLinkedChanges.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-blue-900 uppercase tracking-wide">
              What explains this yield change?
            </span>
          </div>

          <div className="space-y-3">
            {shapLinkedChanges.map(key => {
              const shap = shapRanks[key];
              const valA = scenarioA.inputs[key];
              const valB = scenarioB.inputs[key];
              const isHighImpact = shap.rank <= 3;

              return (
                <div key={key}
                  className={`rounded-lg p-3 text-xs leading-relaxed ${
                    isHighImpact
                      ? "bg-amber-50 border border-amber-200 text-amber-900"
                      : "bg-white border border-blue-100 text-blue-900"
                  }`}>
                  <div className="font-semibold mb-0.5">
                    {INPUT_LABELS[key]}
                    {isHighImpact && (
                      <span className="ml-2 text-[10px] font-medium bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">
                        High-impact driver
                      </span>
                    )}
                  </div>
                  <div className="text-slate-600 mt-0.5">
                    Ranked <strong>#{shap.rank}</strong> driver for{" "}
                    <span className="capitalize">{scenarioA.crop.replace(/_/g, " ")}</span>,
                    avg influence <strong>{shap.value.toFixed(0)} Kg/ha</strong>.
                    Change: <strong>{formatChange(valA, valB)}</strong>.
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-blue-200 flex items-center gap-2 text-xs text-blue-700">
            <Info size={11} className="shrink-0" />
            <span>
              Net outcome:{" "}
              <strong>{yieldDelta >= 0 ? "+" : ""}{yieldDelta.toFixed(1)} Kg/ha</strong>
              {" "}({yieldDelta >= 0 ? "+" : ""}{yieldPct}% from Scenario A).{" "}
              SHAP importance reflects average influence across the 2006-2015 test dataset.
            </span>
          </div>
        </div>
      )}

      {/* Edge case: inputs changed but none are in SHAP top 10 */}
      {changedInputs.length > 0 && shapLinkedChanges.length === 0 && (
        <div className="bg-slate-50 border rounded-xl p-4 text-xs text-slate-500 flex items-start gap-2">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            The parameters changed between scenarios are not among the top 10 SHAP drivers for{" "}
            <span className="capitalize">{scenarioA.crop.replace(/_/g, " ")}</span>.
            Their direct impact on the predicted yield is likely small.
          </span>
        </div>
      )}

      {changedInputs.length === 0 && (
        <div className="bg-slate-50 border rounded-xl p-4 text-xs text-slate-500 flex items-start gap-2">
          <Info size={13} className="mt-0.5 shrink-0" />
          No parameters were changed between Scenario A and B. Adjust some inputs and re-run to compare.
        </div>
      )}
    </div>
  );
}

