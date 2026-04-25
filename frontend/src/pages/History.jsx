import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchHistory, reportYield, deleteRecommendation } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { CheckCircle, AlertCircle, AlertTriangle, Download, Loader2, ChevronDown, MapPin, ArrowRight, Trash2 } from "lucide-react";
import YieldTrendChart from "../components/YieldTrendChart";
import { generateAdvisoryPDF } from "../lib/pdfReport";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const LEVEL_ICON  = { green: CheckCircle, amber: AlertCircle, red: AlertTriangle };
const LEVEL_COLOR = { green: "text-emerald-600", amber: "text-amber-500", red: "text-red-500" };
const LEVEL_BADGE = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red:   "bg-red-100 text-red-700",
};

const VERDICT_STYLE = {
  correct:      { bg: "bg-emerald-50 border-emerald-200 text-emerald-700", icon: "✓" },
  miss:         { bg: "bg-red-50 border-red-200 text-red-700",             icon: "✗" },
  overestimate: { bg: "bg-amber-50 border-amber-200 text-amber-700",       icon: "△" },
  underestimate:{ bg: "bg-blue-50 border-blue-200 text-blue-700",          icon: "↑" },
  false_alarm:  { bg: "bg-slate-50 border-slate-200 text-slate-600",       icon: "△" },
};

function getClassificationVerdict(advisoryLevel, actualLevel) {
  if (!advisoryLevel || !actualLevel) return null;
  if (advisoryLevel === actualLevel) {
    const labels = {
      green: "Correct classification — good harvest confirmed",
      amber: "Correct classification — moderate harvest confirmed",
      red:   "Correct classification — poor harvest warning confirmed",
    };
    return { type: "correct", label: labels[advisoryLevel] };
  }
  if (advisoryLevel === "green" && actualLevel === "red")
    return { type: "miss",         label: "False positive — good harvest predicted, poor harvest occurred" };
  if (advisoryLevel === "green" && actualLevel === "amber")
    return { type: "overestimate", label: "Overestimated — harvest was moderate, not the predicted good level" };
  if (advisoryLevel === "amber" && actualLevel === "red")
    return { type: "overestimate", label: "Underestimated severity — harvest fell below the Q25 threshold" };
  if (advisoryLevel === "amber" && actualLevel === "green")
    return { type: "underestimate", label: "Underestimated — harvest exceeded median, better than forecast" };
  if (advisoryLevel === "red"   && actualLevel === "green")
    return { type: "false_alarm",  label: "False alarm — harvest was good, model over-warned" };
  if (advisoryLevel === "red"   && actualLevel === "amber")
    return { type: "false_alarm",  label: "Conservative — moderate harvest, model was overly cautious" };
  return null;
}

export default function History() {
  const [records,        setRecords]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [cropFilter,     setCropFilter]     = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [dateFrom,       setDateFrom]       = useState("");
  const [dateTo,         setDateTo]         = useState("");
  const [sortOrder,      setSortOrder]      = useState("newest");
  const { profile } = useAuth();

  useEffect(() => {
    fetchHistory()
      .then((d) => setRecords(d.recommendations || []))
      .catch((e) => setError(e.response?.data?.error || "Failed to load history"))
      .finally(() => setLoading(false));
  }, []);

  function downloadCSV() {
    if (!records.length) return;
    const headers = [
      "Date", "Crop", "District", "Level",
      "Predicted Yield (Kg/ha)", "Hist Median (Kg/ha)",
      "Actual Yield (Kg/ha)", "Actual Level", "Model Error (%)",
      "Classification Verdict", "Season Conditions", "Status",
      "Irr Threshold", "NPK Threshold (Kg/ha)", "Rainfall Dev Low (%)", "Rainfall Dev High (%)", "Heat Stress Max (σ)",
      "Actions",
    ];
    const rows = records.map((r) => {
      const errPct = r.actual_yield != null && r.predicted_yield
        ? ((r.actual_yield - r.predicted_yield) / r.predicted_yield * 100).toFixed(1)
        : "";
      const verdict = getClassificationVerdict(r.level, r.actual_level);
      return [
        new Date(r.created_at).toLocaleDateString(),
        r.crop,
        r.district_name || "National average",
        r.level,
        r.predicted_yield,
        r.hist_median,
        r.actual_yield ?? "",
        r.actual_level ?? "",
        errPct,
        verdict ? verdict.label : "",
        r.season_score === 100 ? "Favourable" : r.season_score === 50 ? "Mixed" : r.season_score === 0 ? "Challenging" : "",
        r.status,
        r.applied_thresholds?.irrigation_min ?? "",
        r.applied_thresholds?.npk_min ?? "",
        r.applied_thresholds?.rainfall_dev_low ?? "",
        r.applied_thresholds?.rainfall_dev_high ?? "",
        r.applied_thresholds?.heat_stress_max ?? "",
        (r.actions || []).join("; "),
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `advisory_history_${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click();
  }

  const crops     = [...new Set(records.map((r) => r.crop))];
  const districts = [...new Set(records.filter((r) => r.district_name).map((r) => r.district_name))];

  const filtered = records
    .filter((r) => cropFilter     === "all" || r.crop          === cropFilter)
    .filter((r) => districtFilter === "all" || r.district_name === districtFilter)
    .filter((r) => !dateFrom || new Date(r.created_at) >= new Date(dateFrom))
    .filter((r) => !dateTo   || new Date(r.created_at) <= new Date(dateTo + "T23:59:59"))
    .sort((a, b) => {
      if (sortOrder === "oldest")     return new Date(a.created_at) - new Date(b.created_at);
      if (sortOrder === "yield_desc") return b.predicted_yield - a.predicted_yield;
      if (sortOrder === "yield_asc")  return a.predicted_yield - b.predicted_yield;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  const greenCount    = records.filter(r => r.level === "green").length;
  const acceptedCount = records.filter(r => r.status === "accepted").length;
  const acceptRate    = records.length > 0 ? Math.round((acceptedCount / records.length) * 100) : 0;
  const avgDelta      = records.length > 0
    ? Math.round(records.reduce((s, r) => s + (r.predicted_yield - r.hist_median), 0) / records.length)
    : 0;
  const cropBreakdown = crops.map(c => {
    const cRecs  = records.filter(r => r.crop === c);
    const cDelta = Math.round(cRecs.reduce((s, r) => s + (r.predicted_yield - r.hist_median), 0) / cRecs.length);
    return { crop: c, count: cRecs.length, avgDelta: cDelta, accepted: cRecs.filter(r => r.status === "accepted").length };
  }).sort((a, b) => b.count - a.count);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Advisory History</h1>
          <p className="text-sm text-slate-500 mt-1">
            {profile?.role === "admin" ? "All users' advisories" : "Your advisories"} &mdash; {records.length} records
          </p>
        </div>
        <button onClick={downloadCSV} disabled={!records.length}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">
          <Download size={16} /> Export CSV
        </button>
      </div>

      {records.length > 0 && (
        <div className="space-y-3 mb-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-slate-800">{records.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">Total advisories</div>
            </div>
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold ${avgDelta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {avgDelta >= 0 ? "+" : ""}{avgDelta.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Avg vs district median (Kg/ha)</div>
            </div>
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600">{greenCount}</div>
              <div className="text-xs text-slate-500 mt-0.5">Good yield outcomes</div>
            </div>
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{acceptRate}%</div>
              <div className="text-xs text-slate-500 mt-0.5">Advisory accept rate</div>
            </div>
          </div>

          {/* Cross-reference to Admin confusion matrix when misclassifications exist */}
          {(() => {
            const misclassified = records.filter(r =>
              r.actual_level && r.level && r.actual_level !== r.level
            );
            const confirmed = records.filter(r =>
              r.actual_level && r.level && r.actual_level === r.level
            );
            const totalReported = records.filter(r => r.actual_level).length;
            if (totalReported === 0) return null;
            const accuracy = Math.round((confirmed.length / totalReported) * 100);
            const hasMiss = misclassified.length > 0;
            return (
              <div className={`rounded-xl border p-3 flex items-center justify-between gap-3
                ${hasMiss ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-base leading-none mt-0.5">{hasMiss ? "⚠️" : "✓"}</span>
                  <div>
                    <p className={`text-xs font-semibold ${hasMiss ? "text-amber-800" : "text-emerald-800"}`}>
                      {totalReported} harvest{totalReported !== 1 ? "s" : ""} reported · {accuracy}% classification accuracy
                    </p>
                    <p className={`text-xs mt-0.5 ${hasMiss ? "text-amber-700" : "text-emerald-700"}`}>
                      {hasMiss
                        ? `${misclassified.length} misclassification${misclassified.length !== 1 ? "s" : ""} detected — the model shows a systematic pattern. See the full confusion matrix analysis in Admin.`
                        : "All reported harvests match their predicted advisory level."}
                    </p>
                  </div>
                </div>
                {hasMiss && profile?.role === "admin" && (
                  <Link to="/admin"
                    className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-3 py-1.5 rounded-lg transition whitespace-nowrap">
                    Model Evaluation <ArrowRight size={12} />
                  </Link>
                )}
              </div>
            );
          })()}

          {cropBreakdown.length > 1 && (
            <div className="bg-white border rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Per-crop breakdown</p>
              <div className="space-y-2">
                {cropBreakdown.map(({ crop, count, avgDelta: cd, accepted }) => (
                  <div key={crop} className="flex items-center gap-2 text-sm">
                    <span className="w-24 text-xs font-medium text-slate-700 capitalize shrink-0">{crop.replace(/_/g, " ")}</span>
                    <span className="text-xs text-slate-400 w-12 shrink-0">{count} run{count !== 1 ? "s" : ""}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${cd >= 0 ? "bg-emerald-400" : "bg-red-400"}`}
                        style={{ width: `${Math.min(100, Math.abs(cd) / 500 * 100)}%` }} />
                    </div>
                    <span className={`text-xs font-medium w-20 text-right shrink-0 ${cd >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {cd >= 0 ? "+" : ""}{cd.toLocaleString()} Kg/ha
                    </span>
                    <span className="hidden sm:block text-xs text-slate-400 w-16 text-right shrink-0">{accepted} accepted</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Yield progression chart */}
          {records.length > 1 && <YieldProgressionChart records={records} />}
        </div>
      )}

      {records.length > 0 && (
        <div className="space-y-2 mb-4">
          {crops.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {["all", ...crops].map((c) => (
                <button key={c} onClick={() => setCropFilter(c)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition
                    ${cropFilter === c ? "bg-slate-800 text-white" : "bg-white border text-slate-600 hover:bg-slate-50"}`}>
                  {c === "all" ? "All crops" : c.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {districts.length > 1 && (
              <div className="flex items-center gap-1.5">
                <MapPin size={13} className="text-slate-400" />
                <select value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}
                  className="text-xs border rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300">
                  <option value="all">All districts</option>
                  {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">From</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="text-xs border rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="text-xs border rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300" />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="text-xs text-slate-400 hover:text-slate-600 underline">clear</button>
              )}
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-slate-400">Sort</span>
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
                className="text-xs border rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="yield_desc">Highest yield</option>
                <option value="yield_asc">Lowest yield</option>
              </select>
            </div>
          </div>

          {(cropFilter !== "all" || districtFilter !== "all" || dateFrom || dateTo) && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Showing {filtered.length} of {records.length} records</span>
              <button onClick={() => { setCropFilter("all"); setDistrictFilter("all"); setDateFrom(""); setDateTo(""); setSortOrder("newest"); }}
                className="text-blue-500 hover:underline">Reset all filters</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white border rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-5 h-5 rounded-full bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3.5 bg-slate-200 rounded w-20" />
                    <div className="h-3.5 bg-slate-100 rounded-full w-14" />
                    <div className="h-3.5 bg-slate-100 rounded-full w-24" />
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded w-32" />
                </div>
                <div className="text-right space-y-1.5 shrink-0">
                  <div className="h-4 bg-slate-200 rounded w-24 ml-auto" />
                  <div className="h-3 bg-slate-100 rounded w-16 ml-auto" />
                </div>
                <div className="w-4 h-4 bg-slate-100 rounded shrink-0" />
              </div>
              <div className="mt-3 mx-4 h-1.5 bg-slate-100 rounded-full" />
              <div className="flex justify-between mt-1 px-4">
                <div className="h-2 bg-slate-50 rounded w-4" />
                <div className="h-2 bg-slate-50 rounded w-20" />
                <div className="h-2 bg-slate-50 rounded w-8" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border rounded-xl p-12 text-center text-slate-400">
          <p className="text-base">No advisories yet</p>
          <p className="text-sm mt-1">Run a prediction on the Dashboard to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((rec) => (
            <HistoryRow
              key={rec.id}
              rec={rec}
              onDeleted={(id) => setRecords((prev) => prev.filter((r) => r.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const DOT = { green: "#10b981", amber: "#f59e0b", red: "#ef4444" };
function CustomDot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={5} fill={DOT[payload.level] || "#94a3b8"} stroke="white" strokeWidth={2} />;
}

function YieldProgressionChart({ records }) {
  const [activeCrop, setActiveCrop] = useState("all");
  const crops = [...new Set(records.map(r => r.crop))];
  const filtered = activeCrop === "all" ? records : records.filter(r => r.crop === activeCrop);

  const chartData = [...filtered]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map(r => ({
      date:   new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      yield:  r.predicted_yield,
      actual: r.actual_yield ?? null,
      level:  r.level,
      crop:   r.crop,
      median: r.hist_median || null,
    }));

  const avgMedian = (() => {
    const w = filtered.filter(r => r.hist_median);
    return w.length ? Math.round(w.reduce((s, r) => s + r.hist_median, 0) / w.length) : null;
  })();

  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Your Yield Predictions Over Time
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Each dot = one advisory ·{" "}
            <span className="text-emerald-600 font-medium">green</span> above median ·{" "}
            <span className="text-amber-500 font-medium">amber</span> near median ·{" "}
            <span className="text-red-500 font-medium">red</span> below Q25
          </p>
        </div>
        {crops.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            {["all", ...crops].map(c => (
              <button key={c} onClick={() => setActiveCrop(c)}
                className={`text-[10px] px-2 py-1 rounded-full border transition ${
                  activeCrop === c
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}>
                {c === "all" ? "All crops" : c.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                 tickFormatter={v => v.toLocaleString()} width={58} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload;
            const errPct = d.actual != null && d.yield
              ? ((d.actual - d.yield) / d.yield * 100).toFixed(1)
              : null;
            return (
              <div className="bg-white border rounded-lg shadow-md p-2.5 text-xs space-y-0.5">
                <p className="font-medium capitalize mb-1">{d.crop.replace(/_/g, " ")} · {d.date}</p>
                <p className="text-slate-700">Predicted: <span className="font-mono font-semibold">{d.yield?.toLocaleString()} Kg/ha</span></p>
                {d.actual != null && (
                  <p className="text-violet-700">Actual: <span className="font-mono font-semibold">{d.actual.toLocaleString()} Kg/ha</span>
                    {errPct !== null && (
                      <span className={`ml-1.5 ${parseFloat(errPct) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        ({parseFloat(errPct) >= 0 ? "+" : ""}{errPct}%)
                      </span>
                    )}
                  </p>
                )}
                {d.median && <p className="text-slate-400 mt-0.5">district median {d.median.toLocaleString()}</p>}
              </div>
            );
          }} />
          {avgMedian && (
            <ReferenceLine y={avgMedian} stroke="#94a3b8" strokeDasharray="4 2"
                           label={{ value: "avg median", position: "insideTopRight", fontSize: 9, fill: "#94a3b8", dy: -4 }} />
          )}
          <Line dataKey="yield" stroke="#e2e8f0" strokeWidth={1.5} dot={<CustomDot />} activeDot={false} connectNulls />
          <Line
            dataKey="actual"
            stroke="#7c3aed"
            strokeWidth={0}
            dot={(props) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null || payload.actual == null) return null;
              return (
                <g key={`actual-${cx}-${cy}`}>
                  <polygon
                    points={`${cx},${cy - 6} ${cx + 5},${cy + 3} ${cx - 5},${cy + 3}`}
                    fill="white"
                    stroke="#7c3aed"
                    strokeWidth={2}
                  />
                </g>
              );
            }}
            activeDot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {chartData.some(d => d.actual != null) && (
        <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block border-2 border-white shadow-sm" />
            Predicted yield (coloured by advisory)
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" style={{ display: "inline" }}>
              <polygon points="6,1 11,10 1,10" fill="white" stroke="#7c3aed" strokeWidth="2" />
            </svg>
            Actual harvest reported
          </span>
          <span className="text-slate-400 ml-1">— hover a point to see model error %</span>
        </div>
      )}
    </div>
  );
}

function MiniYieldGauge({ predicted, median, level }) {
  if (!predicted || !median || median <= 0) return null;
  const scale   = median * 2;
  const predPct = Math.min(97, Math.max(3, (predicted / scale) * 100));
  const dotColor = level === "green" ? "bg-emerald-500" : level === "amber" ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="relative h-1.5 bg-slate-100 rounded-full mt-2 mx-4 mb-1"
      title={`${predicted.toLocaleString()} Kg/ha vs median ${median.toLocaleString()} Kg/ha`}>
      <div className="absolute left-0 top-0 h-full w-1/2 bg-red-100 rounded-l-full" />
      <div className="absolute left-1/2 top-0 h-full w-1/2 bg-emerald-100 rounded-r-full" />
      <div className="absolute top-0 h-full w-px bg-slate-400" style={{ left: "50%" }} />
      <div className={`absolute -top-[3px] w-3 h-3 rounded-full ${dotColor} border-2 border-white shadow-sm transition-all`}
        style={{ left: `${predPct}%`, transform: "translateX(-50%)" }} />
    </div>
  );
}


function HarvestFeedbackCard({ rec, actualYield, actualLevel, verdict, vs, generatingPDF, setGeneratingPDF }) {
  const errPct  = rec.predicted_yield
    ? (actualYield - rec.predicted_yield) / rec.predicted_yield * 100
    : null;
  const absErr  = errPct != null ? Math.abs(errPct) : null;
  const isOver  = errPct != null && errPct < 0;

  const accCfg = absErr == null ? null
    : absErr < 10  ? { label: "Excellent",  bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", bar: "bg-emerald-400" }
    : absErr < 20  ? { label: "Good",       bg: "bg-blue-50 border-blue-200",       text: "text-blue-700",    bar: "bg-blue-400"    }
    : absErr < 35  ? { label: "Moderate",   bg: "bg-amber-50 border-amber-200",     text: "text-amber-700",   bar: "bg-amber-400"   }
    :                { label: "High error", bg: "bg-red-50 border-red-200",         text: "text-red-700",     bar: "bg-red-400"     };

  function getNudge() {
    if (absErr == null) return null;
    const actual = actualYield.toLocaleString();
    if (absErr < 10) return {
      icon: "✓", heading: "Ready for next season",
      text: `Your actual yield (${actual} Kg/ha) closely matched the prediction. Use ${actual} Kg/ha as your yield lag input next season for the most accurate forecast.`,
    };
    if (isOver && absErr >= 20) return {
      icon: "↓", heading: "Plan conservatively next season",
      text: `The model overestimated by ${absErr.toFixed(0)}%. Enter ${actual} Kg/ha as your yield lag next season — this moves the model closer to your actual conditions.`,
    };
    if (!isOver && absErr >= 20) return {
      icon: "↑", heading: "Update your yield lag upward",
      text: `Your harvest exceeded the prediction by ${absErr.toFixed(0)}%. Enter ${actual} Kg/ha as your yield lag next season — this gives the model a more accurate starting point and may unlock a higher advisory level.`,
    };
    return {
      icon: "~", heading: "Minor variance — inputs look consistent",
      text: `The ${absErr.toFixed(0)}% error is within the model's typical range. Use ${actual} Kg/ha as your yield lag next season for continuity.`,
    };
  }
  const nudge = getNudge();

  return (
    <>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Harvest Outcome
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div className="bg-slate-50 rounded-lg p-2.5">
          <div className="text-slate-400 mb-0.5">Predicted</div>
          <div className="font-semibold text-slate-700">{rec.predicted_yield?.toLocaleString()} Kg/ha</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-2.5">
          <div className="text-slate-400 mb-0.5">Actual harvest</div>
          <div className="font-semibold text-slate-700">{actualYield?.toLocaleString()} Kg/ha</div>
        </div>
        <div className={`rounded-lg p-2.5 border ${accCfg?.bg || "bg-slate-50"}`}>
          <div className="text-slate-400 mb-0.5">Model error</div>
          <div className={`font-semibold ${accCfg?.text || "text-slate-700"}`}>
            {errPct != null ? `${errPct >= 0 ? "+" : ""}${errPct.toFixed(1)}%` : "—"}
          </div>
        </div>
      </div>

      {absErr != null && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-400">Prediction accuracy</span>
            <span className={`text-[10px] font-semibold ${accCfg?.text}`}>
              {accCfg?.label} · {absErr.toFixed(1)}% error
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${accCfg?.bar}`}
              style={{ width: `${Math.min(100, absErr / 50 * 100)}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-slate-300 mt-0.5">
            <span>0% (perfect)</span><span>25%</span><span>50%+</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs mb-3">
        <span className="text-slate-400">Predicted level:</span>
        <span className={`font-semibold capitalize ${LEVEL_COLOR[rec.level]}`}>{rec.level}</span>
        <span className="text-slate-300 mx-0.5">→</span>
        <span className="text-slate-400">Actual level:</span>
        <span className={`font-semibold capitalize ${LEVEL_COLOR[actualLevel] || "text-slate-600"}`}>{actualLevel}</span>
      </div>

      {verdict && vs && (
        <div className={`rounded-lg border p-2.5 text-xs mb-3 ${vs.bg}`}>
          <div className="flex items-center gap-2 font-medium mb-1">
            <span className="text-sm leading-none">{vs.icon}</span>
            <span>{verdict.label}</span>
          </div>
          {(verdict.type === "miss" || verdict.type === "overestimate") && (
            <p className="text-xs opacity-80 pl-5 leading-relaxed">
              Consistent with the model's documented optimistic bias — trained on pre-2005 climate norms, it tends to over-predict under current conditions.
              {rec.season_score != null && rec.season_score < 100 && (
                <span> Season conditions were <span className="font-semibold">{rec.season_score < 50 ? "challenging" : "mixed"}</span> — weather inputs deviated from the training distribution, increasing extrapolation risk.</span>
              )}
            </p>
          )}
          {verdict.type === "false_alarm" && (
            <p className="text-xs opacity-80 pl-5 leading-relaxed">
              The model over-warned relative to actual outcome. Given the documented optimistic bias, this conservative case is atypical.
            </p>
          )}
        </div>
      )}

      {nudge && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm leading-none">{nudge.icon}</span>
            <span className="text-xs font-semibold text-indigo-800">{nudge.heading}</span>
          </div>
          <p className="text-xs text-indigo-700 leading-relaxed pl-5">{nudge.text}</p>
        </div>
      )}

      <button
        onClick={() => {
          const pdfAdvisory = {
            crop: rec.crop, level: rec.level,
            headline: `${rec.crop.replace(/_/g, " ")} advisory — ${rec.level} level`,
            predicted_yield: rec.predicted_yield, hist_median: rec.hist_median,
            hist_q25: rec.hist_median * 0.78, hist_q75: rec.hist_median * 1.22,
            dist_code: rec.dist_code, district_name: rec.district_name,
            actions: rec.actions || [], shap_top10: null, ood_warnings: [],
            actual_yield: actualYield, actual_level: actualLevel,
            season_score: rec.season_score ?? null,
          };
          generateAdvisoryPDF(pdfAdvisory, () => setGeneratingPDF(true), () => setGeneratingPDF(false));
        }}
        disabled={generatingPDF}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition disabled:opacity-40">
        {generatingPDF
          ? <Loader2 size={11} className="animate-spin" />
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>}
        {generatingPDF ? "Generating…" : "Download full audit PDF"}
      </button>
    </>
  );
}

function HistoryRow({ rec, onDeleted }) {
  const [open, setOpen]               = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [reportOpen, setReportOpen]   = useState(false);
  const [reportValue, setReportValue] = useState("");
  const [reporting, setReporting]     = useState(false);
  const [reportResult, setReportResult] = useState(null);
  const [reportError, setReportError]   = useState(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteRecommendation(rec.id);
      onDeleted(rec.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const Icon  = LEVEL_ICON[rec.level]  || AlertCircle;
  const color = LEVEL_COLOR[rec.level] || "text-amber-500";
  const delta     = rec.predicted_yield - rec.hist_median;
  const deltaSign = delta >= 0 ? "+" : "";
  const deltaCol  = delta >= 0 ? "text-emerald-600" : "text-red-600";
  const deltaPct  = rec.hist_median > 0 ? ((delta / rec.hist_median) * 100).toFixed(0) : null;

  // Resolved harvest data — from DB join (rec.actual_yield) or in-session submission
  const actualYield  = rec.actual_yield  ?? reportResult?.actual_yield  ?? null;
  const _rawLevel = rec.actual_level ?? reportResult?.actual_level ?? null;
  const actualLevel = _rawLevel ?? (() => {
    const ay = rec.actual_yield ?? reportResult?.actual_yield ?? null;
    if (!ay || !rec.hist_q25 || !rec.hist_median) return null;
    if (ay < rec.hist_q25)    return "red";
    if (ay < rec.hist_median) return "amber";
    return "green";
  })();
  const hasReport    = actualYield != null;
  const pendingReport = rec.status === "accepted" && !hasReport;
  const verdict      = getClassificationVerdict(rec.level, actualLevel);
  const vs           = verdict ? VERDICT_STYLE[verdict.type] : null;

  const CROP_MAX_YIELD = {
    rice: 10000, wheat: 10000, maize: 20000, sugarcane: 80000,
    pigeonpea: 5000, groundnut: 8000, pearl_millet: 8000,
    chickpea: 5000, sorghum: 8000, cotton: 5000,
  };

  async function handleReport() {
    const val = parseFloat(reportValue);
    if (isNaN(val) || val <= 0) { setReportError("Enter a valid positive yield value."); return; }
    const maxYield = CROP_MAX_YIELD[rec.crop] || 15000;
    if (val > maxYield) { setReportError(`That seems too high for ${rec.crop} (max ~${maxYield.toLocaleString()} Kg/ha). Please check your entry.`); return; }
    setReporting(true);
    setReportError(null);
    try {
      const res = await reportYield(rec.id, val);
      setReportResult(res);
      setReportOpen(false);
    } catch (e) {
      setReportError(e.response?.data?.error || "Failed to submit report.");
    } finally {
      setReporting(false);
    }
  }

  const KEY_INPUTS = {
    YIELD_LAG_1:                     "Last year's yield",
    IRRIGATION_RATIO:                "Irrigation ratio",
    NPK_TOTAL_KG_PER_HA:             "NPK (Kg/ha)",
    "ANNUAL RAINFALL (Millimeters)": "Annual rainfall (mm)",
    KHARIF_TMAX:                     "Kharif max temp (°C)",
  };
  const storedInputs  = rec.inputs || {};
  const displayInputs = Object.entries(KEY_INPUTS)
    .filter(([key]) => storedInputs[key] !== undefined)
    .map(([key, label]) => ({ label, value: storedInputs[key] }));

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      {/* Always-visible header */}
      <div onClick={() => setOpen(v => !v)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setOpen(v => !v)}
        className="w-full flex items-center gap-4 px-4 pt-4 pb-2 cursor-pointer hover:bg-slate-50 transition">
        <Icon size={18} className={`${color} shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm capitalize">{rec.crop.replace(/_/g, " ")}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEVEL_BADGE[rec.level] || LEVEL_BADGE.amber}`}>
              {rec.level}
            </span>
            {rec.district_name && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                <MapPin size={9} />{rec.district_name}
              </span>
            )}
            {rec.status === "accepted" && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Accepted</span>
            )}
            {rec.season_score != null && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                rec.season_score >= 100 ? "bg-emerald-50 text-emerald-600" :
                rec.season_score >= 50  ? "bg-amber-50 text-amber-600"    : "bg-red-50 text-red-600"
              }`}>
                🌱 {rec.season_score >= 100 ? "Favourable" : rec.season_score >= 50 ? "Mixed" : "Challenging"} season
              </span>
            )}
            {/* Classification verdict badge — the closed loop made visible */}
            {hasReport && verdict && vs ? (
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${vs.bg}`}>
                {vs.icon} {verdict.type === "correct" ? "Confirmed" : verdict.type === "miss" ? "Misclassified" : "Outcome filed"}
              </span>
            ) : pendingReport ? (
              <span className="text-xs px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-400 font-medium">
                📊 Yield not reported
              </span>
            ) : null}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{new Date(rec.created_at).toLocaleString()}</div>
        </div>
        <div className="text-right text-sm shrink-0 mr-2">
          <div className="font-semibold text-slate-800">{rec.predicted_yield?.toLocaleString()} Kg/ha</div>
          <div className={`text-xs font-medium ${deltaCol}`}>
            {deltaSign}{delta.toFixed(0)} vs median
            {deltaPct !== null && (
              <span className="text-slate-400 font-normal ml-1">({deltaSign}{deltaPct}%)</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {confirmDelete ? (
            <>
              <span className="text-xs text-slate-500">Delete?</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                disabled={deleting}
                className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-100"
              >
                No
              </button>
            </>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
              title="Delete prediction"
            >
              <Trash2 size={14} />
            </button>
          )}
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </div>

      {!open && (
        <>
          <MiniYieldGauge predicted={rec.predicted_yield} median={rec.hist_median} level={rec.level} />
          <div className="flex justify-between text-[10px] text-slate-300 px-4 pb-2">
            <span>0</span>
            <span className="text-slate-400">median: {rec.hist_median?.toLocaleString()}</span>
            <span>{rec.hist_median ? (rec.hist_median * 2).toLocaleString() : ""}</span>
          </div>
        </>
      )}

      {open && (
        <div className="border-t bg-slate-50 px-4 pb-4 pt-3 space-y-3">
          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Yield position vs district median
            </div>
            <ExpandedYieldBar predicted={rec.predicted_yield} median={rec.hist_median} level={rec.level} />
          </div>

          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              50-year historical context
              {rec.district_name && (
                <span className="ml-2 font-normal text-slate-400 normal-case">· {rec.district_name}</span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Where this prediction sits relative to the long-run district trend.
            </p>
            <YieldTrendChart crop={rec.crop} distCode={rec.dist_code} predictedYield={rec.predicted_yield} />
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-white rounded-lg p-3 border">
              <div className="text-xs text-slate-500 mb-0.5">Predicted yield</div>
              <div className="font-semibold text-slate-800">{rec.predicted_yield?.toLocaleString()} Kg/ha</div>
            </div>
            <div className="bg-white rounded-lg p-3 border">
              <div className="text-xs text-slate-500 mb-0.5">District median</div>
              <div className="font-semibold text-slate-800">{rec.hist_median?.toLocaleString()} Kg/ha</div>
            </div>
            <div className="bg-white rounded-lg p-3 border">
              <div className="text-xs text-slate-500 mb-0.5">Difference</div>
              <div className={`font-semibold ${deltaCol}`}>{deltaSign}{delta.toFixed(0)} Kg/ha</div>
            </div>
          </div>

          {displayInputs.length > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Input parameters used
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {displayInputs.map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-xs py-0.5 border-b border-slate-50">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-medium text-slate-700">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rec.applied_thresholds && (() => {
            const t = rec.applied_thresholds;
            const D = { irrigation_min: 0.3, npk_min: 50.0 };
            const irrOverride = t.irrigation_min !== D.irrigation_min;
            const npkOverride = t.npk_min        !== D.npk_min;
            const anyOverride = irrOverride || npkOverride;
            return (
              <div className="bg-white rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Thresholds applied at advisory time
                  </div>
                  {anyOverride && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 font-medium">
                      custom override active
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-2">
                  {[
                    { label: "Irrigation minimum",  val: t.irrigation_min,    override: irrOverride, default: D.irrigation_min },
                    { label: "NPK minimum (Kg/ha)", val: t.npk_min,           override: npkOverride, default: D.npk_min        },
                    { label: "Rainfall dev. low",   val: `${t.rainfall_dev_low}%`,  override: false },
                    { label: "Rainfall dev. high",  val: `${t.rainfall_dev_high}%`, override: false },
                    { label: "Heat stress max",     val: `${t.heat_stress_max}\u03C3`, override: false },
                  ].map(({ label, val, override, default: def }) => (
                    <div key={label} className="flex justify-between text-xs py-0.5 border-b border-slate-50">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-medium text-slate-700 flex items-center gap-1.5">
                        {val}
                        {override
                          ? <span className="text-[9px] font-semibold text-blue-500">override ({def} default)</span>
                          : <span className="text-[9px] text-slate-300">default</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Exact values active when this advisory was generated — enables reproduction of the verdict independently of current settings.
                </p>
              </div>
            );
          })()}

          {rec.actions?.length > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Recommendations issued
              </div>
              <ul className="space-y-1">
                {rec.actions.map((a, i) => (
                  <li key={i} className="text-xs text-slate-600 flex gap-2">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Only shown on accepted advisories */}
          {rec.status === "accepted" && (
            <div className="bg-white rounded-lg border p-3">
              {hasReport ? (
                <HarvestFeedbackCard
                  rec={rec}
                  actualYield={actualYield}
                  actualLevel={actualLevel}
                  verdict={verdict}
                  vs={vs}
                  generatingPDF={generatingPDF}
                  setGeneratingPDF={setGeneratingPDF}
                />
              ) : (
                /* Not yet reported: show report UI */
                <>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Report Actual Harvest Yield
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Help improve the model by reporting what you actually harvested.
                      </div>
                    </div>
                    <button onClick={() => setReportOpen(v => !v)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition shrink-0 ml-3">
                      {reportOpen ? "Cancel" : "Report yield"}
                    </button>
                  </div>
                  {reportOpen && (
                    <div className="mt-2 flex items-center gap-2">
                      <input type="number" min="1" step="any" placeholder="Actual yield (Kg/ha)"
                        value={reportValue}
                        onChange={e => { setReportValue(e.target.value); setReportError(null); }}
                        className="flex-1 text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      <button onClick={handleReport} disabled={reporting || !reportValue}
                        className="text-xs px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition flex items-center gap-1.5">
                        {reporting && <Loader2 size={12} className="animate-spin" />}
                        Submit
                      </button>
                    </div>
                  )}
                  {reportError && <div className="text-xs text-red-600 mt-1.5">{reportError}</div>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function ExpandedYieldBar({ predicted, median, level }) {
  if (!predicted || !median || median <= 0) return null;
  const scale   = median * 2;
  const predPct = Math.min(97, Math.max(3, (predicted / scale) * 100));
  const delta   = predicted - median;
  const sign    = delta >= 0 ? "+" : "";
  const col     = delta >= 0 ? "text-emerald-600" : "text-red-600";
  const dotColor = level === "green" ? "bg-emerald-500" : level === "amber" ? "bg-amber-400" : "bg-red-400";
  return (
    <div>
      <div className="relative h-3 bg-slate-100 rounded-full mt-1 mb-1">
        <div className="absolute left-0 top-0 h-full w-1/2 bg-red-100 rounded-l-full" />
        <div className="absolute left-1/2 top-0 h-full w-1/2 bg-emerald-100 rounded-r-full" />
        <div className="absolute top-0 h-full w-0.5 bg-slate-400" style={{ left: "50%" }} />
        <div className={`absolute -top-0.5 w-4 h-4 rounded-full ${dotColor} border-2 border-white shadow`}
          style={{ left: `${predPct}%`, transform: "translateX(-50%)" }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>0</span>
        <span className="text-slate-500 font-medium">Median: {median.toLocaleString()} Kg/ha</span>
        <span>{(median * 2).toLocaleString()}</span>
      </div>
      <div className={`text-xs font-medium mt-1 ${col}`}>
        Prediction is {sign}{delta.toFixed(0)} Kg/ha ({sign}{((delta / median) * 100).toFixed(0)}%) vs district median
      </div>
    </div>
  );
}
