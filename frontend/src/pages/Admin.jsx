import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis, ReferenceLine, LineChart, Line, Legend } from "recharts";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { fetchHistory, fetchYieldReports } from "../lib/api";
import { generateAdminPDF } from "../lib/pdfReport";
import {
  BarChart2, Users, TrendingUp, CheckCircle,
  AlertCircle, XCircle, Loader2, Activity, Download,
  RefreshCw, Database, Cpu, FlaskConical, Rocket, ChevronDown, ChevronRight, Info, Zap
} from "lucide-react";

const CROP_COLOURS = {
  rice: "bg-emerald-500", wheat: "bg-amber-500", maize: "bg-yellow-400",
  sorghum: "bg-orange-500", pearl_millet: "bg-lime-500", chickpea: "bg-teal-500",
  pigeonpea: "bg-cyan-500", groundnut: "bg-rose-500", cotton: "bg-blue-500",
  sugarcane: "bg-purple-500",
};

const ALL_CROPS = [
  "rice","wheat","maize","sorghum","pearl_millet",
  "chickpea","pigeonpea","groundnut","cotton","sugarcane"
];

const RETRAIN_THRESHOLD = 5;   // reports needed to be "ready"
const OPTIMAL_THRESHOLD = 20;  // reports for "optimal"

const PIPELINE_STEPS = [
  { icon: Database,    label: "Data Collection",   desc: "Merge user yield reports with ICRISAT historical data. Validate outliers via IQR filter.", ms: 800  },
  { icon: FlaskConical,label: "Preprocessing",     desc: "Recompute lag features, normalise inputs, rebuild temporal train/test split (cutoff: 2015).", ms: 1200 },
  { icon: Cpu,         label: "Model Training",    desc: "Re-fit XGBRegressor with existing hyperparameters on augmented dataset. Estimated: ~40 s on CPU.", ms: 1600 },
  { icon: CheckCircle, label: "Validation",        desc: "Evaluate on held-out 2006–2015 test set. Accept if new R² ≥ old R² − 0.02 (no regression).", ms: 900  },
  { icon: Rocket,      label: "Deployment",        desc: "Swap xgb_models.pkl artefact and reload model_service. Zero-downtime rollover via gunicorn.", ms: 600  },
];

function StatCard({ icon, label, value, colour = "text-emerald-600" }) {
  const Icon = icon;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <Icon className={`w-5 h-5 ${colour} mb-3`} />
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function CropBar({ crop, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="capitalize font-medium text-gray-700">{crop.replace("_", " ")}</span>
        <span className="text-gray-500 font-mono text-xs">{count}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${CROP_COLOURS[crop] || "bg-gray-400"}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LevelRow({ count, total, label, icon, colour, bg, bar }) {
  const Icon = icon;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`${bg} rounded-lg p-3`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${colour} flex-shrink-0`} />
        <div className="flex-1">
          <div className="flex justify-between text-sm mb-1.5">
            <span className={`font-semibold ${colour}`}>{label}</span>
            <span className="font-bold text-gray-700">
              {count} <span className="font-normal text-gray-400 text-xs">({pct}%)</span>
            </span>
          </div>
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
            <div className={`h-full ${bar} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

function exportCSV(recs) {
  const headers = [
    "Time", "User ID", "Crop", "District",
    "Predicted Yield (Kg/ha)", "Hist Median (Kg/ha)", "vs Median (%)",
    "Advisory Level", "Status",
    "Actual Yield (Kg/ha)", "Actual Level", "Error (%)",
    "Season Score", "Applied Thresholds",
  ];
  const rows = recs.map(r => {
    const delta      = r.hist_median ? Math.round(((r.predicted_yield - r.hist_median) / r.hist_median) * 100) : "";
    const deltaStr   = delta !== "" ? (delta >= 0 ? `+${delta}` : String(delta)) : "";
    const errorPct   = r.actual_yield != null && r.predicted_yield
      ? (((r.actual_yield - r.predicted_yield) / r.predicted_yield) * 100).toFixed(1)
      : "";
    const errorStr   = errorPct !== "" ? (parseFloat(errorPct) >= 0 ? `+${errorPct}` : errorPct) : "";
    const thresholds = r.applied_thresholds
      ? `"${JSON.stringify(r.applied_thresholds).replace(/"/g, '""')}"`
      : "";
    return [
      `"${new Date(r.created_at).toLocaleString("en-GB")}"`,
      r.user_id || "",
      r.crop?.replace(/_/g, " ") || "",
      r.district_name || "",
      r.predicted_yield ?? "",
      r.hist_median ?? "",
      deltaStr,
      r.level || "",
      r.status || "",
      r.actual_yield ?? "",
      r.actual_level || "",
      errorStr,
      r.season_score ?? "",
      thresholds,
    ].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cropAdvisor_export_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─────────────────────────────────────────────
   Confusion Matrix
   ───────────────────────────────────────────── */
const LEVEL_LABELS  = { red: "Red", amber: "Amber", green: "Green" };
const LEVEL_CELL_CL = {
  red:   { bg: "bg-red-50",     text: "text-red-700",     pill: "bg-red-100 text-red-700" },
  amber: { bg: "bg-amber-50",   text: "text-amber-700",   pill: "bg-amber-100 text-amber-700" },
  green: { bg: "bg-emerald-50", text: "text-emerald-700", pill: "bg-emerald-100 text-emerald-700" },
};
const LEVELS = ["red", "amber", "green"];

function ConfusionMatrix({ reports }) {
  const classifiable = reports.filter(r => r.advisory_level && r.actual_level);

  if (classifiable.length === 0) {
    return (
      <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-6 text-center">
        <p className="text-sm font-medium text-slate-500">No classifiable reports yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Once yield reports are filed and <code>actual_level</code> is computed, the confusion matrix will appear here.
        </p>
      </div>
    );
  }

  // matrix[predicted][actual] = count
  const matrix = {};
  LEVELS.forEach(p => { matrix[p] = {}; LEVELS.forEach(a => { matrix[p][a] = 0; }); });
  classifiable.forEach(r => {
    if (matrix[r.advisory_level]?.[r.actual_level] !== undefined)
      matrix[r.advisory_level][r.actual_level]++;
  });

  const rowTotals = {};
  LEVELS.forEach(p => { rowTotals[p] = LEVELS.reduce((s, a) => s + matrix[p][a], 0); });
  const colTotals = {};
  LEVELS.forEach(a => { colTotals[a] = LEVELS.reduce((s, p) => s + matrix[p][a], 0); });

  const correct  = LEVELS.reduce((s, l) => s + matrix[l][l], 0);
  const accuracy = Math.round((correct / classifiable.length) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Advisory Level Confusion Matrix
        </p>
        <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
          {accuracy}% classification accuracy · {classifiable.length} reports
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Rows = predicted advisory level · Columns = actual level from reported harvest · <span className="text-emerald-600 font-medium">Green diagonal = correct prediction</span>
      </p>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-auto">
          <thead>
            <tr>
              <th className="w-28 p-2 text-right text-slate-400 font-normal text-[10px] italic">Predicted ↓ / Actual →</th>
              {LEVELS.map(a => (
                <th key={a} className="w-20 p-2 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${LEVEL_CELL_CL[a].pill}`}>
                    {LEVEL_LABELS[a]}
                  </span>
                </th>
              ))}
              <th className="w-20 p-2 text-center text-slate-400 font-medium text-[10px]">Precision</th>
            </tr>
          </thead>
          <tbody>
            {LEVELS.map(p => {
              const rowTotal  = rowTotals[p];
              const precision = rowTotal > 0 ? Math.round((matrix[p][p] / rowTotal) * 100) : null;
              return (
                <tr key={p}>
                  <td className="p-2 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${LEVEL_CELL_CL[p].pill}`}>
                      {LEVEL_LABELS[p]}
                    </span>
                  </td>
                  {LEVELS.map(a => {
                    const count      = matrix[p][a];
                    const isDiag     = p === a;
                    const isError    = !isDiag && count > 0;
                    const cellPct    = rowTotal > 0 ? Math.round((count / rowTotal) * 100) : 0;
                    return (
                      <td key={a} className={`p-2 text-center border ${
                        isDiag  ? "bg-emerald-50 border-emerald-200" :
                        isError ? "bg-red-50 border-red-100" :
                                  "bg-white border-slate-100"
                      }`}>
                        <div className={`text-lg font-bold ${
                          isDiag  ? "text-emerald-700" :
                          isError ? "text-red-500" :
                                    "text-slate-300"
                        }`}>{count}</div>
                        {rowTotal > 0 && (
                          <div className="text-[10px] text-slate-400">{cellPct}%</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="p-2 text-center">
                    {precision !== null
                      ? <span className={`font-bold ${precision >= 70 ? "text-emerald-600" : precision >= 40 ? "text-amber-600" : "text-red-500"}`}>{precision}%</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="p-2 text-right text-[10px] text-slate-500 font-semibold">Recall</td>
              {LEVELS.map(a => {
                const colTotal = colTotals[a];
                const recall   = colTotal > 0 ? Math.round((matrix[a][a] / colTotal) * 100) : null;
                return (
                  <td key={a} className="p-2 text-center border-t border-slate-100">
                    {recall !== null
                      ? <span className={`font-bold text-xs ${recall >= 70 ? "text-emerald-600" : recall >= 40 ? "text-amber-600" : "text-red-500"}`}>{recall}%</span>
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                );
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
        <span className="font-semibold">Precision</span> — of all advisories predicted at that level, what % matched the actual outcome.&nbsp;
        <span className="font-semibold">Recall</span> — of all actual outcomes at that level, what % did the model correctly anticipate.
      </p>

      {(() => {
        const greenPredTotal   = rowTotals["green"];
        const greenWrong       = greenPredTotal - matrix["green"]["green"];
        const neverPredRed     = rowTotals["red"] === 0 && colTotals["red"] > 0;
        const optimisticBias   = colTotals["red"] > 0 && matrix["green"]["red"] > 0;
        const redMispredPct    = colTotals["red"] > 0
          ? Math.round((matrix["green"]["red"] / colTotals["red"]) * 100) : 0;

        if (!optimisticBias && !neverPredRed) return null;

        return (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Finding: Systematic optimistic bias detected
            </p>
            <p className="text-[11px] text-amber-700 leading-relaxed">
              {neverPredRed && (
                <>The model issued <span className="font-semibold">zero Red advisories</span> across {classifiable.length} predictions, 
                yet {colTotals["red"]} harvest{colTotals["red"] > 1 ? "s" : ""} actually fell below the Q25 threshold (Red outcome). </>
              )}
              {optimisticBias && (
                <>{redMispredPct}% of actual Red outcomes were predicted Green — 
                the model systematically assigns optimistic advisories to what turn out to be poor-yield seasons. </>
              )}
              {greenWrong > 0 && greenPredTotal > 0 && (
                <>Green advisory precision: {Math.round((matrix["green"]["green"] / greenPredTotal) * 100)}% 
                ({greenWrong} of {greenPredTotal} "good outlook" advisories did not match the actual harvest level). </>
              )}
            </p>
          </div>
        );
      })()}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Calibration Plot
   ───────────────────────────────────────────── */
function CalibrationPlot({ reports }) {
  const paired = reports.filter(r => r.predicted_yield != null && r.actual_yield != null);

  if (paired.length < 3) {
    return (
      <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-6 text-center">
        <p className="text-sm font-medium text-slate-500">Not enough reports for calibration</p>
        <p className="text-xs text-slate-400 mt-1">Need at least 3 yield reports. Currently: {paired.length}.</p>
      </div>
    );
  }

  // Sort by predicted yield, divide into ≤6 equal-count bands
  const sorted  = [...paired].sort((a, b) => a.predicted_yield - b.predicted_yield);
  const nBins   = Math.min(6, Math.max(2, Math.floor(sorted.length / 1)));
  const binSize = Math.ceil(sorted.length / nBins);

  const chartData = [];
  for (let i = 0; i < sorted.length; i += binSize) {
    const bin          = sorted.slice(i, i + binSize);
    const meanPred     = Math.round(bin.reduce((s, r) => s + r.predicted_yield, 0) / bin.length);
    const meanActual   = Math.round(bin.reduce((s, r) => s + r.actual_yield,    0) / bin.length);
    chartData.push({ band: meanPred.toLocaleString(), predicted: meanPred, actual: meanActual, n: bin.length });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Model Calibration — Predicted vs Actual by Yield Band
        </p>
        <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
          {paired.length} reports · {chartData.length} bands
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Reports grouped by predicted yield band. A well-calibrated model's actual yields (purple) track the perfect-calibration line (green) closely.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="band"
            tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
            label={{ value: "Mean predicted yield (Kg/ha)", position: "insideBottom", offset: -16, fontSize: 10, fill: "#9ca3af" }}
          />
          <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={68}
            tickFormatter={v => v.toLocaleString()}
            label={{ value: "Mean actual (Kg/ha)", angle: -90, position: "insideLeft", offset: 14, fontSize: 10, fill: "#9ca3af" }}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            formatter={(value, name) => [
              value.toLocaleString() + " Kg/ha",
              name === "actual" ? "Mean actual yield" : "Perfect calibration",
            ]}
          />
          <Legend verticalAlign="top" height={24} iconSize={8}
            formatter={v => v === "actual" ? "Mean actual yield" : "Perfect calibration"}
          />
          <Line type="monotone" dataKey="predicted" stroke="#10b981" strokeDasharray="5 3"
            strokeWidth={1.5} dot={false} name="perfect" />
          <Line type="monotone" dataKey="actual" stroke="#6366f1" strokeWidth={2}
            dot={{ fill: "#6366f1", r: 4 }} activeDot={{ r: 6 }} name="actual" />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
        Purple consistently above green = model systematically underestimates; below = overestimates. Interpret with caution below 10 reports.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Retraining Pipeline Stub
   ───────────────────────────────────────────── */
function RetrainingPanel({ driftData, cusum }) {
  const [simulating, setSimulating] = useState(null);   // crop name being simulated
  const [stepsDone,  setStepsDone]  = useState(0);       // how many pipeline steps completed
  const [done,       setDone]       = useState({});      // { crop: true } when finished

  const summary = driftData?.summary || {};

  // Build per-crop readiness rows (all 10 crops)
  const cropRows = ALL_CROPS.map(crop => {
    const count  = summary[crop]?.count || 0;
    const mae    = summary[crop]?.mae   || null;
    const hasDrift = cusum?.[crop]?.drift_detected === true;
    const status = hasDrift && count >= RETRAIN_THRESHOLD ? "drift"
                 : count >= OPTIMAL_THRESHOLD ? "optimal"
                 : count >= RETRAIN_THRESHOLD  ? "ready"
                 : "insufficient";
    return { crop, count, mae, status, hasDrift };
  });

  const readyCount   = cropRows.filter(r => r.status !== "insufficient").length;
  const driftCount   = cropRows.filter(r => r.status === "drift").length;
  const totalReports = Object.values(summary).reduce((s, v) => s + (v.count || 0), 0);

  async function runSimulation(crop) {
    setSimulating(crop);
    setStepsDone(0);
    setDone(d => ({ ...d, [crop]: false }));
    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      await new Promise(res => setTimeout(res, PIPELINE_STEPS[i].ms));
      setStepsDone(i + 1);
    }
    setSimulating(null);
    setDone(d => ({ ...d, [crop]: true }));
  }

  function ReadinessBadge({ status }) {
    if (status === "drift")        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 uppercase tracking-wide flex items-center gap-1"><AlertCircle className="w-3 h-3" />Drift Detected</span>;
    if (status === "optimal")      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide">Optimal</span>;
    if (status === "ready")        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase tracking-wide">Ready</span>;
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-wide">Insufficient</span>;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">

      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-indigo-500" />
            Model Retraining Pipeline
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Tracks when accumulated yield reports justify retraining each crop model.
          </p>
        </div>
        <span className="text-xs bg-indigo-50 text-indigo-600 font-semibold px-2.5 py-1 rounded-full border border-indigo-100">
          Simulation Mode
        </span>
      </div>

      {/* System readiness summary */}
      <div className="mt-4 mb-5 grid grid-cols-4 gap-3">
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-slate-800">{totalReports}</div>
          <div className="text-xs text-slate-500 mt-0.5">Total reports collected</div>
        </div>
        <div className={`rounded-lg p-3 text-center ${readyCount > 0 ? "bg-amber-50" : "bg-slate-50"}`}>
          <div className={`text-xl font-bold ${readyCount > 0 ? "text-amber-700" : "text-slate-400"}`}>
            {readyCount} / 10
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Crops eligible for retraining</div>
        </div>
        <div className={`rounded-lg p-3 text-center ${driftCount > 0 ? "bg-red-50" : "bg-slate-50"}`}>
          <div className={`text-xl font-bold ${driftCount > 0 ? "text-red-700" : "text-slate-400"}`}>
            {driftCount}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">CUSUM drift alerts</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-slate-800">{RETRAIN_THRESHOLD}</div>
          <div className="text-xs text-slate-500 mt-0.5">Reports required per crop</div>
        </div>
      </div>

      {/* Explainer */}
      <div className="flex items-start gap-2 mb-4 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5">
        <Info className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
        <p className="text-xs text-indigo-700 leading-relaxed">
          In production, retraining is triggered either by sufficient report count or by a
          CUSUM drift alarm — a formal statistical signal that accumulated prediction errors
          have crossed the control threshold. The pipeline merges collected yield reports with
          ICRISAT training data, re-fits the XGBoost model, validates against the held-out test set,
          and hot-swaps the artefact if performance does not regress.
        </p>
      </div>

      {/* Per-crop table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs border-b border-gray-100">
              {["Crop", "Reports", "Field MAE", "Status", "Action"].map(h => (
                <th key={h} className="text-left pb-2 pr-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {cropRows.map(({ crop, count, mae, status }) => {
              const isRunning  = simulating === crop;
              const isDone     = done[crop];
              const canRun     = status !== "insufficient" && !isRunning && !simulating;

              return (
                <tr key={crop} className="hover:bg-gray-50/50">
                  <td className="py-2.5 pr-4 font-medium capitalize text-gray-800">
                    {crop.replace(/_/g, " ")}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            status === "optimal" ? "bg-emerald-500"
                            : status === "ready" ? "bg-amber-400"
                            : "bg-slate-300"
                          }`}
                          style={{ width: `${Math.min(100, (count / OPTIMAL_THRESHOLD) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-600">{count}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-xs font-mono text-gray-500">
                    {mae != null ? `${mae.toLocaleString()} Kg/ha` : "—"}
                  </td>
                  <td className="py-2.5 pr-4">
                    <ReadinessBadge status={status} />
                  </td>
                  <td className="py-2.5">
                    {isDone && !isRunning ? (
                      <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Simulated
                      </span>
                    ) : (
                      <button
                        onClick={() => canRun && runSimulation(crop)}
                        disabled={!canRun}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg border transition ${
                          status === "insufficient"
                            ? "border-slate-100 text-slate-300 cursor-not-allowed bg-white"
                            : simulating && simulating !== crop
                            ? "border-slate-100 text-slate-300 cursor-not-allowed bg-white"
                            : "border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 cursor-pointer"
                        }`}
                      >
                        {isRunning
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</>
                          : status === "insufficient"
                          ? `Need ${RETRAIN_THRESHOLD - count} more`
                          : <><RefreshCw className="w-3 h-3" /> Simulate</>
                        }
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pipeline visualisation — shown when simulating */}
      {simulating && (
        <div className="mt-5 border border-indigo-100 rounded-xl bg-indigo-50 px-4 py-4">
          <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide mb-4 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5" />
            Retraining pipeline — {simulating.replace(/_/g, " ")}
          </p>
          <div className="space-y-3">
            {PIPELINE_STEPS.map((step, i) => {
              const StepIcon = step.icon;
              const active   = i === stepsDone;
              const complete = i < stepsDone;
              return (
                <div key={step.label} className={`flex items-start gap-3 transition-opacity duration-300 ${
                  !complete && !active ? "opacity-30" : "opacity-100"
                }`}>
                  <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition ${
                    complete ? "bg-emerald-500"
                    : active  ? "bg-indigo-500"
                    : "bg-slate-200"
                  }`}>
                    {complete
                      ? <CheckCircle className="w-3.5 h-3.5 text-white" />
                      : active
                      ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                      : <StepIcon className="w-3 h-3 text-slate-400" />
                    }
                  </div>
                  <div>
                    <div className={`text-xs font-semibold ${
                      complete ? "text-emerald-700"
                      : active  ? "text-indigo-700"
                      : "text-slate-400"
                    }`}>{step.label}</div>
                    {(complete || active) && (
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{step.desc}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Completed state */}
      {Object.values(done).some(Boolean) && !simulating && (
        <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-emerald-700 flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5" />
            Simulation complete — in production this model artefact would now be live.
          </p>
          <p className="text-[11px] text-emerald-600 mt-1 leading-relaxed">
            The updated XGBoost model would be validated against the 2006–2015 held-out test set before deployment.
            If R² does not regress beyond the 0.02 tolerance, the new xgb_models.pkl artefact is hot-swapped
            and model_service reloaded — serving all future predictions with the drift-corrected model.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   CUSUM Drift Detection Panel
   ───────────────────────────────────────────── */
function CUSUMPanel({ cusum }) {
  const cropsWithData = Object.entries(cusum || {}).filter(([, d]) => d.n_errors >= 2);

  if (cropsWithData.length === 0) {
    return (
      <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-6 text-center">
        <p className="text-sm font-medium text-slate-500">Insufficient data for drift detection</p>
        <p className="text-xs text-slate-400 mt-1">
          CUSUM requires at least 2 yield reports per crop. Continue collecting harvest outcomes.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          CUSUM Sequential Drift Detection
        </p>
        <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
          {cropsWithData.length} crop{cropsWithData.length !== 1 ? "s" : ""} monitored
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        When C⁺ or C⁻ crosses the alarm threshold (red dashed line), the model shows systematic drift
        warranting retraining. <span className="text-blue-500 font-medium">Blue</span> = underestimate accumulation (C⁺),{" "}
        <span className="text-amber-500 font-medium">Amber</span> = overestimate accumulation (C⁻).
      </p>

      <div className="space-y-5">
        {cropsWithData.map(([crop, d]) => {
          const chartData = d.cusum_pos.map((_, i) => ({
            idx: `Report ${i + 1}`,
            c_pos: d.cusum_pos[i],
            c_neg: d.cusum_neg[i],
          }));

          return (
            <div key={crop} className="border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50">
                <span className="text-sm font-semibold text-slate-700 capitalize">
                  {crop.replace(/_/g, " ")}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">
                    σ = {d.sigma} Kg/ha · k = {d.k_allowance} · h = {d.threshold}
                  </span>
                  {d.drift_detected ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 uppercase flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Drift — {d.drift_direction}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Within control limits
                    </span>
                  )}
                </div>
              </div>

              <div className="px-4 py-3">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="idx" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
                      formatter={(value, name) => [
                        `${value} Kg/ha`,
                        name === "c_pos" ? "C⁺ (underestimate)" : "C⁻ (overestimate)",
                      ]}
                    />
                    <Legend
                      iconType="line" iconSize={10}
                      formatter={v => <span className="text-[10px] text-slate-500">{v === "c_pos" ? "C⁺ underestimate" : "C⁻ overestimate"}</span>}
                    />
                    <ReferenceLine y={d.threshold} stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1.5}
                      label={{ value: "Alarm threshold", position: "insideTopRight", fontSize: 9, fill: "#dc2626" }}
                    />
                    <Line dataKey="c_pos" stroke="#3b82f6" strokeWidth={2}
                      dot={{ fill: "#3b82f6", r: 3 }} activeDot={{ r: 5 }} name="c_pos" />
                    <Line dataKey="c_neg" stroke="#f59e0b" strokeWidth={2}
                      dot={{ fill: "#f59e0b", r: 3 }} activeDot={{ r: 5 }} name="c_neg" />
                  </LineChart>
                </ResponsiveContainer>

                {d.drift_detected && (
                  <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <p className="text-[11px] text-red-700 leading-relaxed">
                      <span className="font-bold">Alarm:</span> CUSUM statistic has crossed the h = {d.threshold} Kg/ha threshold,
                      indicating the model is systematically <span className="font-semibold">{d.drift_direction}</span> for {crop.replace(/_/g, " ")}.
                      This is a formal statistical signal for retraining consideration.
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-1.5 mt-4 pt-3 border-t border-slate-100">
        <Info className="w-3 h-3 text-slate-300 mt-0.5 shrink-0" />
        <p className="text-[10px] text-slate-400 leading-relaxed">
          C⁺ accumulates evidence of underestimation; C⁻ accumulates evidence of overestimation.
          When either statistic exceeds h, the null hypothesis of a calibrated model is rejected.
        </p>
      </div>
    </div>
  );
}

function SeasonScoreCalibrationPanel({ reports }) {
  const scored = reports.filter(r => r.season_score != null && r.abs_error != null);

  if (scored.length < 3) {
    return (
      <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-6 text-center">
        <p className="text-sm font-medium text-slate-500">Not enough season-scored reports</p>
        <p className="text-xs text-slate-400 mt-1">
          Need at least 3 yield reports with season scores. Currently: {scored.length}.
        </p>
      </div>
    );
  }

  const BUCKETS = [
    { score: 100, label: "Favourable", colour: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
    { score: 50,  label: "Mixed",      colour: "bg-amber-400",   text: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200"  },
    { score: 0,   label: "Challenging",colour: "bg-red-500",     text: "text-red-700",     bg: "bg-red-50",     border: "border-red-200"    },
  ];

  const bucketData = BUCKETS.map(b => {
    const group  = scored.filter(r => r.season_score === b.score);
    const mae    = group.length > 0 ? Math.round(group.reduce((s, r) => s + r.abs_error, 0) / group.length) : null;
    const avgBias = group.length > 0 ? (group.reduce((s, r) => s + r.error_pct, 0) / group.length).toFixed(1) : null;
    return { ...b, count: group.length, mae, avgBias };
  }).filter(b => b.count > 0);

  const maxMAE  = Math.max(...bucketData.map(b => b.mae || 0), 1);
  const favMAE  = bucketData.find(b => b.score === 100)?.mae;
  const chalMAE = bucketData.find(b => b.score === 0)?.mae;
  const hasInsight  = favMAE != null && chalMAE != null;
  const improvement = hasInsight ? Math.round(((chalMAE - favMAE) / chalMAE) * 100) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Season Score vs Prediction Accuracy
        </p>
        <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
          {scored.length} season-scored report{scored.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Does the season outlook score predict how accurate the model will be? Lower MAE in Favourable seasons
        validates the score as a meaningful confidence signal — not just a label.
      </p>

      <div className={`grid gap-3 grid-cols-${bucketData.length}`}>
        {bucketData.map(b => (
          <div key={b.label} className={`rounded-xl border ${b.border} ${b.bg} p-4 text-center`}>
            <div className={`text-xs font-bold uppercase tracking-wide ${b.text} mb-3`}>{b.label}</div>
            <div className="flex justify-center mb-3">
              <div className="w-12 rounded-lg bg-white/50 flex flex-col-reverse overflow-hidden" style={{ height: "72px" }}>
                <div
                  className={`w-full transition-all duration-700 ${b.colour}`}
                  style={{ height: `${b.mae ? Math.round((b.mae / maxMAE) * 100) : 0}%` }}
                />
              </div>
            </div>
            <div className={`text-xl font-bold ${b.text}`}>
              {b.mae != null ? b.mae.toLocaleString() : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">MAE (Kg/ha)</div>
            <div className="text-[10px] text-slate-500 mt-2 font-medium">
              {b.count} report{b.count !== 1 ? "s" : ""}
            </div>
            {b.avgBias != null && (
              <div className={`text-[10px] mt-1 font-semibold ${parseFloat(b.avgBias) < 0 ? "text-amber-600" : "text-blue-600"}`}>
                avg bias: {parseFloat(b.avgBias) >= 0 ? "+" : ""}{b.avgBias}%
              </div>
            )}
          </div>
        ))}
      </div>

      {hasInsight && (
        <div className={`mt-4 rounded-lg px-4 py-3 border ${
          improvement > 0 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
        }`}>
          <p className={`text-xs leading-relaxed ${improvement > 0 ? "text-emerald-800" : "text-amber-800"}`}>
            {improvement > 0 ? (
              <>
                <span className="font-bold">Season score correlates with accuracy: </span>
                MAE is <span className="font-semibold">{Math.abs(improvement)}% lower</span> in Favourable
                seasons ({favMAE.toLocaleString()} Kg/ha) vs Challenging ({chalMAE.toLocaleString()} Kg/ha).
                This validates the season score as a calibrated confidence signal — the model is more reliable
                when conditions align with its 1966–2005 training distribution.
              </>
            ) : (
              <>
                <span className="font-bold">Season score does not reduce error in this sample: </span>
                MAE is similar across conditions ({favMAE.toLocaleString()} vs {chalMAE.toLocaleString()} Kg/ha).
                This may reflect insufficient reports or that crop-specific factors dominate prediction error.
              </>
            )}
          </p>
        </div>
      )}

      <div className="flex items-start gap-1.5 mt-3 pt-3 border-t border-slate-100">
        <Info className="w-3 h-3 text-slate-300 mt-0.5 shrink-0" />
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Season score is computed at advisory generation time from z-score deviations of rainfall and temperature
          against the crop's own training distribution. Favourable = all signals within normal range (score 100);
          Challenging = one or more signals critically deviated (score 0).
        </p>
      </div>
    </div>
  );
}

function MAETrendChart({ reports }) {
  const withError = reports.filter(r => r.abs_error != null && r.reported_at);
  if (withError.length < 2) {
    return (
      <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-6 text-center">
        <p className="text-sm font-medium text-slate-500">Not enough reports for trend analysis</p>
        <p className="text-xs text-slate-400 mt-1">Need at least 2 yield reports. Currently: {withError.length}.</p>
      </div>
    );
  }
  const weekMap = {};
  withError.forEach(r => {
    const week = getISOWeek(new Date(r.reported_at));
    if (!weekMap[week]) weekMap[week] = { all: [], byCrop: {} };
    weekMap[week].all.push(r.abs_error);
    if (!weekMap[week].byCrop[r.crop]) weekMap[week].byCrop[r.crop] = [];
    weekMap[week].byCrop[r.crop].push(r.abs_error);
  });
  const sortedWeeks = Object.keys(weekMap).sort();
  const cropWeekCounts = {};
  withError.forEach(r => {
    const week = getISOWeek(new Date(r.reported_at));
    if (!cropWeekCounts[r.crop]) cropWeekCounts[r.crop] = new Set();
    cropWeekCounts[r.crop].add(week);
  });
  const trendCrops = Object.entries(cropWeekCounts).filter(([, w]) => w.size >= 2).map(([c]) => c);
  const chartData = sortedWeeks.map(week => {
    const entry = { week: week.replace(/^\d{4}-/, "") };
    const allE = weekMap[week].all;
    entry.overall = Math.round(allE.reduce((s, e) => s + e, 0) / allE.length);
    trendCrops.forEach(crop => {
      const errs = weekMap[week].byCrop[crop];
      entry[crop] = errs ? Math.round(errs.reduce((s, e) => s + e, 0) / errs.length) : null;
    });
    return entry;
  });
  const vals = chartData.map(d => d.overall).filter(Boolean);
  const mid = Math.floor(vals.length / 2);
  const firstAvg = mid > 0 ? vals.slice(0, mid).reduce((s, v) => s + v, 0) / mid : 0;
  const secondAvg = vals.length - mid > 0 ? vals.slice(mid).reduce((s, v) => s + v, 0) / (vals.length - mid) : 0;
  const trendPct = firstAvg > 0 ? Math.round(((secondAvg - firstAvg) / firstAvg) * 100) : 0;
  const isDrifting  = trendPct >  10 && vals.length >= 3;
  const isImproving = trendPct < -10 && vals.length >= 3;
  const CROP_LINE_COLOURS = {
    rice: "#10b981", wheat: "#f59e0b", maize: "#eab308", sorghum: "#f97316",
    pearl_millet: "#84cc16", chickpea: "#14b8a6", pigeonpea: "#06b6d4",
    groundnut: "#f43f5e", cotton: "#3b82f6", sugarcane: "#a855f7",
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          MAE Over Time — Model Drift Indicator
        </p>
        <div className="flex items-center gap-2">
          {isDrifting && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> MAE rising +{trendPct}%
            </span>
          )}
          {isImproving && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              MAE improving {trendPct}%
            </span>
          )}
          <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
            {withError.length} reports &middot; {sortedWeeks.length} week{sortedWeeks.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Mean absolute error of yield predictions grouped by submission week.
        A rising trend is a formal drift signal — accumulated errors worsening over time indicate
        the model needs retraining.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
            label={{ value: "Submission week", position: "insideBottom", offset: -16, fontSize: 10, fill: "#9ca3af" }} />
          <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={64}
            tickFormatter={v => v.toLocaleString()}
            label={{ value: "MAE (Kg/ha)", angle: -90, position: "insideLeft", offset: 14, fontSize: 10, fill: "#9ca3af" }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
            formatter={(value, name) => [value != null ? `${value.toLocaleString()} Kg/ha` : "—",
              name === "overall" ? "Overall MAE" : name.replace(/_/g, " ")]} />
          <Legend verticalAlign="top" height={24} iconSize={8}
            formatter={v => <span className="text-[10px] text-slate-500">{v === "overall" ? "Overall MAE" : v.replace(/_/g, " ")}</span>} />
          <Line type="monotone" dataKey="overall" stroke="#6366f1" strokeWidth={2.5}
            dot={{ fill: "#6366f1", r: 4 }} activeDot={{ r: 6 }} name="overall" connectNulls />
          {trendCrops.map(crop => (
            <Line key={crop} type="monotone" dataKey={crop}
              stroke={CROP_LINE_COLOURS[crop] || "#94a3b8"} strokeWidth={1.5} strokeDasharray="4 2"
              dot={{ fill: CROP_LINE_COLOURS[crop] || "#94a3b8", r: 3 }} name={crop} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {isDrifting && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-[11px] text-red-700 leading-relaxed">
            <span className="font-bold">Drift signal: </span>
            Average MAE in the second half of reports ({Math.round(secondAvg).toLocaleString()} Kg/ha) is {trendPct}% higher
            than the first half ({Math.round(firstAvg).toLocaleString()} Kg/ha). This systematic increase is consistent
            with concept drift — the relationship between inputs and yield may have shifted since the 1966&ndash;2005
            training period.
          </p>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
        Solid indigo = overall MAE across all crops. Dashed lines = per-crop MAE (shown for crops with reports in 2+ weeks).
      </p>
    </div>
  );
}


/* ─────────────────────────────────────────────
   Generic collapsible section wrapper
   ───────────────────────────────────────────── */
function CollapsibleSection({ title, defaultOpen = false, badge = null, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-100 pt-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between mb-3 group"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide group-hover:text-slate-700 transition">
            {title}
          </span>
          {badge && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-300 group-hover:text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ADF Stationarity Panel
   ───────────────────────────────────────────── */
function ADFPanel({ adf }) {
  const crops = Object.entries(adf || {}).filter(([, d]) => d && d.p_value !== null);

  if (crops.length === 0) {
    return (
      <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-6 text-center">
        <p className="text-sm font-medium text-slate-500">Insufficient data for stationarity test</p>
        <p className="text-xs text-slate-400 mt-1">
          ADF test requires at least 5 yield reports per crop.
        </p>
      </div>
    );
  }

  const nDrifting = crops.filter(([, d]) => !d.is_stationary).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          ADF Stationarity Test — Unit Root Detection
        </p>
        <div className="flex items-center gap-2">
          {nDrifting > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {nDrifting} non-stationary
            </span>
          )}
          <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
            {crops.length} crop{crops.length !== 1 ? "s" : ""} tested
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Augmented Dickey-Fuller test for unit roots in the prediction error series.{" "}
        <span className="text-emerald-600 font-medium">Stationary (p &lt; 0.05)</span> = stable calibration;{" "}
        <span className="text-red-500 font-medium">non-stationary (p &ge; 0.05)</span> = systematic drift cannot be ruled out.
      </p>

      <div className="space-y-2">
        {[...crops]
          .sort(([, a], [, b]) => (a.is_stationary === b.is_stationary ? 0 : a.is_stationary ? 1 : -1))
          .map(([crop, d]) => (
            <div
              key={crop}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg border flex-wrap ${
                d.is_stationary
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-red-50 border-red-200"
              }`}
            >
              <span className="w-28 shrink-0 text-xs font-semibold text-slate-700 capitalize">
                {crop.replace(/_/g, " ")}
              </span>

              {d.is_stationary ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1 shrink-0">
                  <CheckCircle className="w-3 h-3" /> Stationary
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1 shrink-0">
                  <AlertCircle className="w-3 h-3" /> Non-stationary
                </span>
              )}

              <div className="flex items-center gap-4 text-[11px] font-mono text-slate-500">
                <span>
                  p ={" "}
                  <span className={`font-bold ${d.p_value < 0.05 ? "text-emerald-700" : "text-red-600"}`}>
                    {d.p_value.toFixed(4)}
                  </span>
                </span>
                <span>ADF = {d.adf_stat}</span>
                <span>n = {d.n_errors}</span>
              </div>

              <span className="ml-auto text-[10px] text-slate-400 hidden md:block text-right max-w-xs">
                {d.interpretation}
              </span>
            </div>
          ))}
      </div>

      <div className="flex items-start gap-1.5 mt-4 pt-3 border-t border-slate-100">
        <Info className="w-3 h-3 text-slate-300 mt-0.5 shrink-0" />
        <p className="text-[10px] text-slate-400 leading-relaxed">
          The Augmented Dickey-Fuller (ADF) test is a regression-based unit root test.
          Rejecting H₀ at p &lt; 0.05 confirms errors are mean-reverting: the model has no long-run systematic bias.
        </p>
      </div>
    </div>
  );
}

export default function Admin() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [recs, setRecs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [driftData, setDriftData] = useState(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [openSections, setOpenSections] = useState({ weekly: false, districts: false, recent: false, users: false });
  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== "admin") { navigate("/dashboard"); return; }
    fetchHistory()
      .then(d => setRecs(d.recommendations || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    fetchYieldReports()
      .then(d => setDriftData(d))
      .catch(() => setDriftData({ reports: [], summary: {} }));
  }, [profile, navigate]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin w-8 h-8 text-emerald-500" /></div>;
  if (error) return <div className="p-8 text-red-500 text-sm">Failed to load analytics: {error}</div>;

  const total       = recs.length;
  const uniqueUsers = new Set(recs.map(r => r.user_id)).size;
  const accepted    = recs.filter(r => r.status === "accepted").length;
  const acceptRate  = total > 0 ? Math.round((accepted / total) * 100) : 0;

  const cropCounts = {};
  recs.forEach(r => { cropCounts[r.crop] = (cropCounts[r.crop] || 0) + 1; });
  const maxCrop     = Math.max(...Object.values(cropCounts), 1);
  const sortedCrops = Object.entries(cropCounts).sort((a, b) => b[1] - a[1]);

  const levelCounts = { red: 0, amber: 0, green: 0 };
  recs.forEach(r => { if (r.level in levelCounts) levelCounts[r.level]++; });

  const weeklyActivity = (() => {
    const map = {};
    recs.forEach(r => {
      const week = getISOWeek(new Date(r.created_at));
      map[week] = (map[week] || 0) + 1;
    });
    return Object.entries(map).sort().slice(-8);
  })();

  const districtActivity = (() => {
    const map = {};
    recs.forEach(r => {
      const name = r.district_name || "National avg";
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));
  })();

  const recent = [...recs]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 12);

  const userStats = (() => {
    const map = {};
    recs.forEach(r => {
      if (!map[r.user_id]) map[r.user_id] = { user_id: r.user_id, count: 0, accepted: 0, crops: new Set(), lastActive: r.created_at, totalDelta: 0 };
      const u = map[r.user_id];
      u.count++;
      if (r.status === "accepted") u.accepted++;
      u.crops.add(r.crop);
      if (r.hist_median) u.totalDelta += (r.predicted_yield - r.hist_median);
      if (r.created_at > u.lastActive) u.lastActive = r.created_at;
    });
    return Object.values(map)
      .map(u => ({ ...u, crops: u.crops.size, avgDelta: Math.round(u.totalDelta / u.count), acceptRate: Math.round((u.accepted / u.count) * 100) }))
      .sort((a, b) => b.count - a.count);
  })();

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-emerald-600" />
            Admin Analytics
          </h1>
          <p className="text-gray-500 mt-1 text-sm">System-wide prediction statistics across all users</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => exportCSV(recs)} disabled={recs.length === 0}
            className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 text-gray-700
                       hover:bg-gray-50 disabled:opacity-40 px-3 py-1.5 rounded-lg font-medium transition shadow-sm">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            onClick={() => generateAdminPDF(
              { recs, driftData },
              () => setPdfGenerating(true),
              () => setPdfGenerating(false)
            )}
            disabled={pdfGenerating || recs.length === 0}
            className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 px-3 py-1.5 rounded-lg font-medium transition shadow-sm">
            {pdfGenerating
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />}
            {pdfGenerating ? "Generating…" : "Export PDF"}
          </button>
          <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
            Admin View
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp}  label="Total Predictions" value={total.toLocaleString()} colour="text-emerald-600" />
        <StatCard icon={Users}       label="Unique Users"       value={uniqueUsers}             colour="text-blue-600" />
        <StatCard icon={CheckCircle} label="Accepted"           value={accepted}                colour="text-emerald-600" />
        <StatCard icon={Activity}    label="Acceptance Rate"    value={`${acceptRate}%`}        colour="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-gray-400" /> Predictions by Crop
          </h2>
          {sortedCrops.length === 0 ? (
            <p className="text-gray-400 text-sm">No predictions yet.</p>
          ) : (
            <div className="space-y-3">
              {sortedCrops.map(([crop, count]) => (
                <CropBar key={crop} crop={crop} count={count} max={maxCrop} />
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-gray-400" /> Advisory Level Breakdown
          </h2>
          <div className="space-y-3">
            <LevelRow level="green" count={levelCounts.green} total={total}
              label="Green — Good outlook" icon={CheckCircle}
              colour="text-emerald-700" bg="bg-emerald-50" bar="bg-emerald-500" />
            <LevelRow level="amber" count={levelCounts.amber} total={total}
              label="Amber — Below average" icon={AlertCircle}
              colour="text-amber-700" bg="bg-amber-50" bar="bg-amber-400" />
            <LevelRow level="red" count={levelCounts.red} total={total}
              label="Red — Poor outlook" icon={XCircle}
              colour="text-red-700" bg="bg-red-50" bar="bg-red-500" />
          </div>
          {total > 0 && (
            <p className="text-xs text-gray-400 mt-4 border-t border-gray-100 pt-3">
              {Math.round((levelCounts.green / total) * 100)}% of all advisories are green
              {levelCounts.red > 0 && ` · ${levelCounts.red} below-average prediction${levelCounts.red > 1 ? "s" : ""} flagged`}
            </p>
          )}
        </div>
      </div>

      {weeklyActivity.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button onClick={() => toggleSection("weekly")}
            className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition text-left">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-gray-400" /> Weekly prediction volume
            </h2>
            <ChevronDown size={15} className={`text-slate-400 transition-transform ${openSections.weekly ? "rotate-180" : ""}`} />
          </button>
          {openSections.weekly && <div className="px-6 pb-6">
          <p className="text-xs text-gray-400 mb-4">Last 8 weeks of platform activity</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={weeklyActivity.map(([w, c]) => ({ week: w.replace(/^\d{4}-/, ""), count: c }))}
              margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [v, "Predictions"]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                cursor={{ fill: "#f9fafb" }} />
              <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
          </div>}
        </div>
      )}

      {districtActivity.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button onClick={() => toggleSection("districts")}
            className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition text-left">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" /> Most Active Districts
            </h2>
            <ChevronDown size={15} className={`text-slate-400 transition-transform ${openSections.districts ? "rotate-180" : ""}`} />
          </button>
          {openSections.districts && <div className="px-6 pb-6">
          <p className="text-xs text-gray-400 mb-4">Districts generating the most advisory requests</p>
          <div className="space-y-2.5">
            {districtActivity.map(({ name, count }) => (
              <div key={name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700 font-medium text-xs">{name}</span>
                  <span className="text-gray-400 text-xs font-mono">{count} prediction{count !== 1 ? "s" : ""}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all duration-700"
                    style={{ width: `${Math.round((count / districtActivity[0].count) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>}
      </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <button onClick={() => toggleSection("recent")}
          className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition text-left">
          <h2 className="font-semibold text-gray-800">Recent Activity</h2>
          <ChevronDown size={15} className={`text-slate-400 transition-transform ${openSections.recent ? "rotate-180" : ""}`} />
        </button>
        {openSections.recent && <div className="px-6 pb-6">
        {recent.length === 0 ? (
          <p className="text-gray-400 text-sm">No predictions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-100">
                  {["Time","Crop","Predicted Yield","vs Median","Level","Status"].map(h => (
                    <th key={h} className="text-left pb-2 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recent.map(r => {
                  const delta = r.hist_median
                    ? Math.round(((r.predicted_yield - r.hist_median) / r.hist_median) * 100)
                    : null;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/50">
                      <td className="py-2 pr-4 text-gray-500 whitespace-nowrap text-xs">
                        {new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-2 pr-4 capitalize font-medium text-gray-800">{r.crop?.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-4 text-gray-700 font-mono text-xs">
                        {r.predicted_yield ? `${r.predicted_yield.toLocaleString()} Kg/ha` : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {delta !== null && (
                          <span className={`text-xs font-semibold ${delta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {delta >= 0 ? "+" : ""}{delta}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                          r.level === "green" ? "bg-emerald-100 text-emerald-700" :
                          r.level === "amber" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                        }`}>{r.level}</span>
                      </td>
                      <td className="py-2">
                        <span className={`text-xs ${r.status === "accepted" ? "text-emerald-600 font-semibold" : "text-gray-400"}`}>
                          {r.status === "accepted" ? "✓ Accepted" : "Pending"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>}
      </div>

      {userStats.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button onClick={() => toggleSection("users")}
            className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition text-left">
            <div>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-400" /> Per-User Breakdown
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">All registered users who have run at least one prediction</p>
            </div>
            <ChevronDown size={15} className={`text-slate-400 transition-transform ${openSections.users ? "rotate-180" : ""}`} />
          </button>
          {openSections.users && <div className="px-6 pb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-100">
                  {["User ID","Predictions","Crops","Avg vs Median","Accepted","Accept Rate","Last Active"].map(h => (
                    <th key={h} className="text-left pb-2 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {userStats.map(u => (
                  <tr key={u.user_id} className="hover:bg-gray-50/50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-400">{u.user_id.slice(0, 8)}…</td>
                    <td className="py-2 pr-4 font-semibold text-gray-800">{u.count}</td>
                    <td className="py-2 pr-4 text-gray-600">{u.crops}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs font-semibold ${u.avgDelta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {u.avgDelta >= 0 ? "+" : ""}{u.avgDelta.toLocaleString()} Kg/ha
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{u.accepted}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${u.acceptRate}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{u.acceptRate}%</span>
                      </div>
                    </td>
                    <td className="py-2 text-xs text-gray-400">
                      {new Date(u.lastActive).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>}
      </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-400" /> Model Drift Monitoring
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Predicted vs actual yields reported by users after harvest. Measures real-world model accuracy.
        </p>

        {!driftData || driftData.reports.length === 0 ? (
          <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-8 text-center">
            <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-500">No yield reports yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Users can report actual harvest yields on accepted advisories in the History page.
              Reports will appear here for drift analysis.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {(() => {
              const allReports = driftData.reports.filter(r => r.abs_error !== null);
              const totalReports = allReports.length;
              const overallMAE = totalReports > 0
                ? Math.round(allReports.reduce((s, r) => s + r.abs_error, 0) / totalReports)
                : 0;
              const avgBias = totalReports > 0
                ? (allReports.reduce((s, r) => s + r.error_pct, 0) / totalReports).toFixed(1)
                : 0;
              const overCount  = allReports.filter(r => r.error_pct < 0).length;
              const underCount = allReports.filter(r => r.error_pct > 0).length;

              const scatterPoints = allReports
                .filter(r => r.predicted_yield && r.actual_yield)
                .map(r => ({ x: Math.round(r.predicted_yield), y: Math.round(r.actual_yield), crop: r.crop }));

              const allVals = scatterPoints.flatMap(p => [p.x, p.y]);
              const axisMin = allVals.length ? Math.floor(Math.min(...allVals) * 0.9 / 100) * 100 : 0;
              const axisMax = allVals.length ? Math.ceil(Math.max(...allVals) * 1.1 / 100) * 100 : 3000;

              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-slate-800">{totalReports}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Yield reports</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-slate-800">{overallMAE.toLocaleString()}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Mean abs error (Kg/ha)</div>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${parseFloat(avgBias) < 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
                      <div className={`text-xl font-bold ${parseFloat(avgBias) < 0 ? "text-amber-700" : "text-emerald-700"}`}>
                        {avgBias >= 0 ? "+" : ""}{avgBias}%
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Avg bias {parseFloat(avgBias) < 0 ? "(overestimates)" : "(underestimates)"}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-slate-800">
                        <span className="text-amber-600">{overCount}</span>
                        <span className="text-slate-300 mx-1">/</span>
                        <span className="text-blue-600">{underCount}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">Over / Under estimates</div>
                    </div>
                  </div>

                  {(() => {
                    const shockEvents = allReports.filter(r => r.is_shock);
                    if (shockEvents.length === 0) return null;
                    return (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3">
                        <Zap className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-red-800 mb-1">
                            {shockEvents.length} Yield Shock Event{shockEvents.length !== 1 ? "s" : ""} detected
                          </p>
                          <p className="text-[11px] text-red-700 leading-relaxed">
                            Reports with prediction error exceeding ±35% are flagged as yield shock events.
                            Errors of this magnitude are consistent with extreme weather not captured in
                            district-level averages — localised floods, droughts, or pest outbreaks that
                            significantly deviated from seasonal norms.
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {scatterPoints.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        Predicted vs Actual — each dot is one user report
                      </p>
                      <p className="text-xs text-slate-400 mb-3">
                        Dots on the diagonal line = perfect prediction. Above = model underestimated. Below = model overestimated.
                      </p>
                      <ResponsiveContainer width="100%" height={260}>
                        <ScatterChart margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                          <XAxis dataKey="x" type="number" name="Predicted"
                            domain={[axisMin, axisMax]}
                            tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                            tickFormatter={v => v.toLocaleString()}
                            label={{ value: "Predicted (Kg/ha)", position: "insideBottom", offset: -2, fontSize: 10, fill: "#9ca3af" }}
                          />
                          <YAxis dataKey="y" type="number" name="Actual"
                            domain={[axisMin, axisMax]}
                            tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                            tickFormatter={v => v.toLocaleString()} width={64}
                            label={{ value: "Actual (Kg/ha)", angle: -90, position: "insideLeft", offset: 12, fontSize: 10, fill: "#9ca3af" }}
                          />
                          <ZAxis range={[40, 40]} />
                          <Tooltip cursor={{ strokeDasharray: "3 3" }}
                            content={({ payload }) => {
                              if (!payload?.length) return null;
                              const d = payload[0].payload;
                              const err = Math.round(((d.y - d.x) / d.x) * 100);
                              return (
                                <div className="bg-white border rounded-lg shadow-md p-2.5 text-xs">
                                  <p className="font-semibold capitalize mb-1">{d.crop?.replace(/_/g, " ")}</p>
                                  <p className="text-slate-500">Predicted: <span className="font-mono text-slate-700">{d.x.toLocaleString()} Kg/ha</span></p>
                                  <p className="text-slate-500">Actual: <span className="font-mono text-slate-700">{d.y.toLocaleString()} Kg/ha</span></p>
                                  <p className={`font-semibold mt-1 ${err >= 0 ? "text-blue-600" : "text-amber-600"}`}>
                                    {err >= 0 ? "Underestimated" : "Overestimated"} by {Math.abs(err)}%
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <ReferenceLine
                            segment={[{ x: axisMin, y: axisMin }, { x: axisMax, y: axisMax }]}
                            stroke="#10b981" strokeDasharray="5 3" strokeWidth={1.5}
                            label={{ value: "Perfect", position: "insideTopLeft", fontSize: 9, fill: "#10b981" }}
                          />
                          <Scatter data={scatterPoints} fill="#6366f1" fillOpacity={0.75} />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {Object.keys(driftData.summary).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Per-crop accuracy from user reports</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-100">
                              {["Crop", "Reports", "MAE (Kg/ha)", "Avg Bias", "Season Conditions", "Overestimates", "Underestimates"].map(h => (
                                <th key={h} className="text-left pb-2 pr-4 font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {Object.entries(driftData.summary)
                              .sort((a, b) => b[1].count - a[1].count)
                              .map(([crop, s]) => (
                                <tr key={crop} className="hover:bg-gray-50/50">
                                  <td className="py-2 pr-4 font-medium capitalize text-gray-800">{crop.replace(/_/g, " ")}</td>
                                  <td className="py-2 pr-4 text-gray-600">{s.count}</td>
                                  <td className="py-2 pr-4 font-mono font-semibold text-gray-800">{s.mae.toLocaleString()}</td>
                                  <td className="py-2 pr-4">
                                    <span className={`font-semibold ${s.avg_err_pct < 0 ? "text-amber-600" : "text-blue-600"}`}>
                                      {s.avg_err_pct >= 0 ? "+" : ""}{s.avg_err_pct}%
                                    </span>
                                  </td>
                                  <td className="py-2 pr-4">
                                    {s.avg_season_score != null ? (
                                      <span className={`text-xs font-semibold ${
                                        s.avg_season_score >= 100 ? "text-emerald-600" :
                                        s.avg_season_score >= 50  ? "text-amber-600"   : "text-red-500"
                                      }`}>
                                        {s.avg_season_score >= 100 ? "Favourable" :
                                         s.avg_season_score >= 50  ? "Mixed"       : "Challenging"}
                                      </span>
                                    ) : <span className="text-slate-300 text-xs">—</span>}
                                  </td>
                                  <td className="py-2 pr-4 text-amber-600 font-medium">{s.overestimates}</td>
                                  <td className="py-2 text-blue-600 font-medium">{s.underestimates}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <CollapsibleSection title="Advisory Level Confusion Matrix" defaultOpen={true}>
                    <ConfusionMatrix reports={driftData.reports} />
                  </CollapsibleSection>

                  <CollapsibleSection title="MAE Drift Indicator">
                    <MAETrendChart reports={driftData.reports} />
                  </CollapsibleSection>

                  <CollapsibleSection title="Model Calibration Plot">
                    <CalibrationPlot reports={driftData.reports} />
                  </CollapsibleSection>

                  <CollapsibleSection title="Season Score vs Accuracy">
                    <SeasonScoreCalibrationPanel reports={driftData.reports} />
                  </CollapsibleSection>

                  <CollapsibleSection title="CUSUM Drift Detection" defaultOpen={true}>
                    <CUSUMPanel cusum={driftData.cusum} />
                  </CollapsibleSection>

                  <CollapsibleSection title="ADF Stationarity Test" defaultOpen={true}>
                    <ADFPanel adf={driftData.adf} />
                  </CollapsibleSection>

                  <CollapsibleSection title="Recent Yield Reports">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent yield reports</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            {["Reported", "Crop", "District", "Predicted", "Actual", "Error %", "Season"].map(h => (
                              <th key={h} className="text-left pb-2 pr-4 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {driftData.reports.slice(0, 10).map(r => (
                            <tr key={r.id} className="hover:bg-gray-50/50">
                              <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                                {new Date(r.reported_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              </td>
                              <td className="py-2 pr-4 capitalize font-medium text-gray-800">{r.crop?.replace(/_/g, " ")}</td>
                              <td className="py-2 pr-4 text-gray-500">{r.district_name || "—"}</td>
                              <td className="py-2 pr-4 font-mono text-gray-700">{r.predicted_yield?.toLocaleString()}</td>
                              <td className="py-2 pr-4 font-mono text-gray-700">{r.actual_yield?.toLocaleString()}</td>
                              <td className="py-2 pr-4">
                                {r.error_pct !== null && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`font-semibold ${r.error_pct < 0 ? "text-amber-600" : "text-blue-600"}`}>
                                      {r.error_pct >= 0 ? "+" : ""}{r.error_pct}%
                                    </span>
                                    {r.is_shock && (
                                      <span
                                        title="Prediction error >35% — consistent with an extreme weather event not captured in district-level averages. Consider checking local NDVI or disaster records for this season."
                                        className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 cursor-help whitespace-nowrap"
                                      >
                                        <Zap className="w-2.5 h-2.5" /> Yield Shock
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-2">
                                {r.season_score != null ? (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                    r.season_score >= 100 ? "bg-emerald-100 text-emerald-700" :
                                    r.season_score >= 50  ? "bg-amber-100 text-amber-700"     : "bg-red-100 text-red-600"
                                  }`}>
                                    {r.season_score >= 100 ? "Good" : r.season_score >= 50 ? "Mixed" : "Poor"}
                                  </span>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CollapsibleSection>
                </>
              );
            })()}
          </div>
        )}
      </div>

      <RetrainingPanel driftData={driftData} cusum={driftData?.cusum} />

    </div>
  );
}
