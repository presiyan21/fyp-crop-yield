import { useState, useEffect, useMemo } from "react";
import { fetchSettings, updateSettings, resetSettings, fetchHistory } from "../lib/api";
import {
  Settings as SettingsIcon, RotateCcw, Save, CheckCircle, AlertCircle, Info, BarChart2,
  ChevronDown, ChevronUp, Leaf,
} from "lucide-react";

const DEFAULTS = {
  irrigation_min:    0.3,
  npk_min:           50,
  rainfall_dev_low:  -20,
  rainfall_dev_high: 40,
  heat_stress_max:   2,
};

const WARN_DIRECTION = {
  irrigation_min:    "below",
  npk_min:           "below",
  rainfall_dev_low:  "below",
  rainfall_dev_high: "above",
  heat_stress_max:   "above",
};

const FIELD_META = [
  {
    key: "irrigation_min", label: "Minimum irrigation ratio", unit: "ratio (0-1)",
    desc: "Trigger an irrigation warning when the ratio falls below this value.",
    min: 0.05, max: 0.9, step: 0.05, histKey: "IRRIGATION_RATIO",
  },
  {
    key: "npk_min", label: "Minimum NPK fertilizer", unit: "Kg/ha",
    desc: "Trigger a fertilizer warning when NPK drops below this level.",
    min: 10, max: 200, step: 5, histKey: "NPK_TOTAL_KG_PER_HA",
  },
  {
    key: "rainfall_dev_low", label: "Rainfall deficit threshold", unit: "% below normal",
    desc: "Flag drought risk when rainfall deviation is more negative than this.",
    min: -60, max: -5, step: 5, histKey: null,
  },
  {
    key: "rainfall_dev_high", label: "Rainfall excess threshold", unit: "% above normal",
    desc: "Flag waterlogging risk when rainfall deviation exceeds this.",
    min: 10, max: 100, step: 5, histKey: null,
  },
  {
    key: "heat_stress_max", label: "Heat stress index limit", unit: "index units",
    desc: "Trigger a heat warning when the computed stress index exceeds this.",
    min: 0.5, max: 5, step: 0.5, histKey: null,
  },
];

function ImpactHistogram({ values, threshold, direction, min, max }) {
  const N = 12;
  const bucketW = (max - min) / N;

  const buckets = Array(N).fill(0);
  values.forEach(v => {
    const i = Math.min(Math.floor((v - min) / bucketW), N - 1);
    if (i >= 0 && i < N) buckets[i]++;
  });
  const peak = Math.max(...buckets, 1);

  const warnCount = direction === "below"
    ? values.filter(v => v < threshold).length
    : values.filter(v => v > threshold).length;
  const warnPct = Math.round((warnCount / values.length) * 100);
  const threshPct = Math.max(0, Math.min(100, ((threshold - min) / (max - min)) * 100));

  const badgeCls = warnCount === 0
    ? "bg-emerald-100 text-emerald-700"
    : warnPct > 50
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
          Your {values.length} past {values.length === 1 ? "advisory" : "advisories"}
        </span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badgeCls}`}>
          {warnCount} / {values.length} would trigger this warning ({warnPct}%)
        </span>
      </div>

      {/* Bar chart with threshold marker */}
      <div className="relative h-10">
        <div className="flex items-end gap-px h-full">
          {buckets.map((count, i) => {
            const mid = min + (i + 0.5) * bucketW;
            const isWarn = direction === "below" ? mid < threshold : mid > threshold;
            const h = count === 0 ? 3 : Math.max((count / peak) * 100, 8);
            return (
              <div key={i} className="flex-1 flex items-end h-full">
                <div
                  className={`w-full rounded-sm transition-colors duration-100 ${
                    isWarn ? "bg-amber-400" : "bg-slate-200"
                  }`}
                  style={{ height: `${h}%` }}
                  title={`${count} ${count === 1 ? "advisory" : "advisories"}`}
                />
              </div>
            );
          })}
        </div>
        {/* Threshold marker line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-slate-700 opacity-60 pointer-events-none"
          style={{ left: `calc(${threshPct}% - 1px)` }}
        >
          <span className="absolute -top-4 left-1 text-[9px] text-slate-700 font-bold whitespace-nowrap">
            {threshold}
          </span>
        </div>
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 mt-1">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function ImpactSummary({ histRecords, values }) {
  if (!histRecords || histRecords.length === 0) return null;

  const n = histRecords.length;
  const irrigVals = histRecords.map(r => r.inputs?.IRRIGATION_RATIO).filter(v => v != null);
  const npkVals   = histRecords.map(r => r.inputs?.NPK_TOTAL_KG_PER_HA).filter(v => v != null);

  if (irrigVals.length === 0 && npkVals.length === 0) return null;

  const irrigWarn = irrigVals.filter(v => v < values.irrigation_min).length;
  const npkWarn   = npkVals.filter(v => v < values.npk_min).length;

  const atLeastOne = histRecords.filter(r => {
    const irrig = r.inputs?.IRRIGATION_RATIO;
    const npk   = r.inputs?.NPK_TOTAL_KG_PER_HA;
    return (irrig != null && irrig < values.irrigation_min)
        || (npk   != null && npk   < values.npk_min);
  }).length;

  const strictnessPct = Math.round((atLeastOne / n) * 100);
  const { label: strictLabel, cls: strictCls } =
    strictnessPct === 0  ? { label: "lenient",     cls: "text-emerald-600" } :
    strictnessPct < 30   ? { label: "moderate",    cls: "text-blue-600"    } :
    strictnessPct < 60   ? { label: "strict",      cls: "text-amber-600"   } :
                           { label: "very strict", cls: "text-red-600"     };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={14} className="text-blue-500" />
        <span className="text-xs font-semibold text-blue-900">
          Configuration Impact &mdash; based on your {n} past {n === 1 ? "advisory" : "advisories"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3 text-center">
        {[
          { val: irrigWarn, label: "irrigation warnings" },
          { val: npkWarn,   label: "NPK warnings" },
          { val: atLeastOne, label: "advisories with \u22651 warning", highlight: true },
        ].map(({ val, label, highlight }) => (
          <div key={label} className="bg-white rounded-lg p-3">
            <div className={`text-xl font-bold ${val === 0 ? "text-emerald-500" : highlight ? strictCls : "text-amber-600"}`}>
              {val}
            </div>
            <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-blue-800 leading-relaxed">
        At current settings, your configuration is{" "}
        <span className={`font-semibold ${strictCls}`}>{strictLabel}</span>
        {atLeastOne === 0
          ? " — none of your past advisories would have triggered a measurable input warning."
          : ` — ${atLeastOne} of ${n} past ${n === 1 ? "advisory" : "advisories"} (${strictnessPct}%) would have triggered at least one input warning.`}
      </p>
    </div>
  );
}

const AGRONOMIC_DEFAULTS = {
  rice:         { irrigation_min: 0.60, npk_min: 80,  rainfall_dev_low: -10, rainfall_dev_high: 30, heat_stress_max: 1.5, context: "High water demand · flooded paddies",      badge: "blue"    },
  wheat:        { irrigation_min: 0.40, npk_min: 80,  rainfall_dev_low: -20, rainfall_dev_high: 35, heat_stress_max: 1.8, context: "Moderate irrigation · key Rabi staple",    badge: "slate"   },
  maize:        { irrigation_min: 0.35, npk_min: 90,  rainfall_dev_low: -20, rainfall_dev_high: 40, heat_stress_max: 2.0, context: "High N demand · moderate water",           badge: "slate"   },
  sorghum:      { irrigation_min: 0.15, npk_min: 40,  rainfall_dev_low: -40, rainfall_dev_high: 50, heat_stress_max: 2.5, context: "Drought tolerant · low input requirement", badge: "amber"   },
  pearl_millet: { irrigation_min: 0.15, npk_min: 40,  rainfall_dev_low: -40, rainfall_dev_high: 50, heat_stress_max: 3.0, context: "Highly drought tolerant · semi-arid",      badge: "amber"   },
  chickpea:     { irrigation_min: 0.20, npk_min: 25,  rainfall_dev_low: -25, rainfall_dev_high: 25, heat_stress_max: 1.5, context: "Legume · fixes N · minimal water need",    badge: "emerald" },
  pigeonpea:    { irrigation_min: 0.20, npk_min: 25,  rainfall_dev_low: -30, rainfall_dev_high: 30, heat_stress_max: 2.0, context: "Legume · N-fixing · drought tolerant",     badge: "emerald" },
  groundnut:    { irrigation_min: 0.30, npk_min: 30,  rainfall_dev_low: -20, rainfall_dev_high: 35, heat_stress_max: 2.0, context: "Legume · moderate water · low N need",     badge: "emerald" },
  cotton:       { irrigation_min: 0.40, npk_min: 80,  rainfall_dev_low: -20, rainfall_dev_high: 35, heat_stress_max: 2.5, context: "High water and nutrient demand",           badge: "slate"   },
  sugarcane:    { irrigation_min: 0.70, npk_min: 120, rainfall_dev_low: -10, rainfall_dev_high: 40, heat_stress_max: 2.0, context: "Very high water demand · long season",     badge: "blue"    },
};

const BADGE_CLS = {
  blue:    "bg-blue-50 text-blue-700",
  slate:   "bg-slate-100 text-slate-600",
  amber:   "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
};

function PerCropOverrides({ cropOverrides, onChange }) {
  const [open, setOpen] = useState(false);
  const activeCount = Object.keys(cropOverrides).length;

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition ${
      activeCount > 0 ? "border-blue-300 ring-1 ring-blue-200" : ""
    }`}>
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2.5">
          <Leaf size={16} className="text-emerald-600" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">Per-Crop Threshold Overrides</span>
              {activeCount > 0 && (
                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  {activeCount} active
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Override all 5 thresholds per crop — irrigation, NPK, rainfall deviation, and heat stress
            </p>
          </div>
        </div>
        {open
          ? <ChevronUp size={16} className="text-slate-400 shrink-0" />
          : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-slate-100">
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
            <p className="text-[11px] text-amber-800 leading-relaxed">
              <strong>Why this matters:</strong> A global threshold of 0.3 irrigation is too lenient for rice
              (needs ≥0.60) and too strict for drought-tolerant sorghum (0.15 is adequate).
              Per-crop overrides ensure every threshold reflects real agronomic requirements.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {Object.entries(AGRONOMIC_DEFAULTS).map(([cropKey, defaults]) => {
              const label    = cropKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
              const override = cropOverrides[cropKey];
              const isActive = !!override;

              const irrVal    = override?.irrigation_min    ?? defaults.irrigation_min;
              const npkVal    = override?.npk_min           ?? defaults.npk_min;
              const rdLowVal  = override?.rainfall_dev_low  ?? defaults.rainfall_dev_low;
              const rdHighVal = override?.rainfall_dev_high ?? defaults.rainfall_dev_high;
              const heatVal   = override?.heat_stress_max   ?? defaults.heat_stress_max;

              function setField(field, val) {
                onChange({ ...cropOverrides, [cropKey]: { ...override, [field]: val } });
              }

              return (
                <div key={cropKey}
                  className={`px-5 py-3 transition ${isActive ? "bg-blue-50/40" : "hover:bg-slate-50/60"}`}>
                  {/* Top row: toggle + label + badge */}
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <button
                      onClick={() => {
                        const next = { ...cropOverrides };
                        if (isActive) {
                          delete next[cropKey];
                        } else {
                          next[cropKey] = {
                            irrigation_min:    defaults.irrigation_min,
                            npk_min:           defaults.npk_min,
                            rainfall_dev_low:  defaults.rainfall_dev_low,
                            rainfall_dev_high: defaults.rainfall_dev_high,
                            heat_stress_max:   defaults.heat_stress_max,
                          };
                        }
                        onChange(next);
                      }}
                      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                        isActive ? "bg-blue-500" : "bg-slate-200"
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full
                                        shadow transition-transform ${
                        isActive ? "translate-x-4" : "translate-x-0"
                      }`} />
                    </button>
                    <div className="flex items-center gap-2 flex-wrap flex-1">
                      <span className={`text-xs font-semibold ${isActive ? "text-slate-800" : "text-slate-500"}`}>
                        {label}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${BADGE_CLS[defaults.badge]}`}>
                        {defaults.context}
                      </span>
                    </div>
                    {!isActive && (
                      <span className="text-[10px] text-slate-300 shrink-0">
                        irr {defaults.irrigation_min} · npk {defaults.npk_min} · rdl {defaults.rainfall_dev_low}% · heat {defaults.heat_stress_max}
                      </span>
                    )}
                  </div>

                  {/* Input grid — only when active */}
                  {isActive && (
                    <div className="ml-12 grid grid-cols-5 gap-2">
                      {[
                        { label: "Irrigation ≥", field: "irrigation_min",    val: irrVal,    min: 0.05, max: 0.95, step: 0.05 },
                        { label: "NPK ≥ Kg/ha",  field: "npk_min",           val: npkVal,    min: 10,   max: 300,  step: 5    },
                        { label: "Rain low %",   field: "rainfall_dev_low",  val: rdLowVal,  min: -60,  max: -5,   step: 5    },
                        { label: "Rain high %",  field: "rainfall_dev_high", val: rdHighVal, min: 10,   max: 100,  step: 5    },
                        { label: "Heat index",   field: "heat_stress_max",   val: heatVal,   min: 0.5,  max: 5,    step: 0.5  },
                      ].map(({ label: fLabel, field, val, min, max, step }) => (
                        <div key={field} className="flex flex-col items-end">
                          <span className="text-[9px] text-slate-400 mb-0.5 text-right leading-tight">{fLabel}</span>
                          <input
                            type="number" min={min} max={max} step={step}
                            value={val}
                            onChange={e => {
                              const v = parseFloat(e.target.value);
                              if (!Number.isNaN(v)) setField(field, v);
                            }}
                            className="w-full p-1 text-xs text-right border border-blue-200 rounded-md
                                       bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
            <p className="text-[10px] text-slate-400">
              All 5 thresholds can be overridden per crop. Active overrides take precedence over global
              thresholds and are stored in the audit trail alongside each advisory.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [values,      setValues]      = useState({ ...DEFAULTS });
  const [isCustom,    setIsCustom]    = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [feedback,    setFeedback]    = useState(null);
  const [histRecords,   setHistRecords]   = useState([]);
  const [cropOverrides, setCropOverrides] = useState({});
  useEffect(() => {
    Promise.all([
      fetchSettings().catch(() => null),
      fetchHistory().catch(() => null),
    ]).then(([settingsData, histData]) => {
      if (settingsData) {
        setValues({ ...DEFAULTS, ...settingsData.thresholds });
        setIsCustom(settingsData.is_custom ?? false);
      }
      if (settingsData) {
        setCropOverrides(settingsData.crop_overrides ?? {});
      }
      if (histData) {
        const records = Array.isArray(histData) ? histData : histData.recommendations ?? [];
        setHistRecords(records.filter(r => r.inputs != null));
      }
    }).catch(() => {
      setFeedback({ type: "error", msg: "Could not load settings." });
    }).finally(() => setLoading(false));
  }, []);

  function handleChange(key, raw) {
    const val = parseFloat(raw);
    if (!Number.isNaN(val)) setValues(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    setSaving(true); setFeedback(null);
    try {
      await updateSettings({ ...values, crop_overrides: cropOverrides });
      setIsCustom(true);
      setFeedback({ type: "success", msg: "Thresholds saved - your next advisory will use these values." });
    } catch {
      setFeedback({ type: "error", msg: "Failed to save settings. Please try again." });
    } finally { setSaving(false); }
  }

  async function handleReset() {
    setSaving(true); setFeedback(null);
    try {
      const { thresholds } = await resetSettings();
      setValues({ ...DEFAULTS, ...thresholds });
      setIsCustom(false);
      setFeedback({ type: "success", msg: "Thresholds reset to system defaults." });
    } catch {
      setFeedback({ type: "error", msg: "Failed to reset settings." });
    } finally { setSaving(false); }
  }

  // Pre-extract history values per threshold field (memoised — only recomputes when histRecords changes)
  const histValues = useMemo(() => {
    const out = {};
    FIELD_META.forEach(({ key, histKey }) => {
      if (histKey) {
        out[key] = histRecords
          .map(r => r.inputs?.[histKey])
          .filter(v => v != null && !Number.isNaN(Number(v)))
          .map(Number);
      }
    });
    return out;
  }, [histRecords]);

  if (loading) return (
    <div className="max-w-2xl mx-auto animate-pulse space-y-4 mt-4">
      {[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <SettingsIcon size={22} className="text-slate-500" />
            Advisory Settings
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure the thresholds used by the rules engine to generate action recommendations.
            {isCustom && (
              <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                Custom
              </span>
            )}
          </p>
        </div>
        {isCustom && (
          <button onClick={handleReset} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border rounded-lg
                       hover:bg-slate-50 disabled:opacity-40 transition shrink-0">
            <RotateCcw size={14} />
            Reset to defaults
          </button>
        )}
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div className={`flex items-start gap-2 p-3 rounded-lg mb-5 text-sm
          ${feedback.type === "success"
            ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
            : "bg-red-50 border border-red-200 text-red-800"}`}>
          {feedback.type === "success"
            ? <CheckCircle size={16} className="mt-0.5 shrink-0" />
            : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          {feedback.msg}
        </div>
      )}

      {/* Live impact summary */}
      <ImpactSummary histRecords={histRecords} values={values} />

      {/* Per-crop overrides */}
      <div className="mb-3">
        <PerCropOverrides cropOverrides={cropOverrides} onChange={setCropOverrides} />
      </div>

      {/* Threshold fields */}
      <div className="space-y-3">
        {FIELD_META.map(({ key, label, unit, desc, min, max, step, histKey }) => {
          const changed = values[key] !== DEFAULTS[key];
          const vals = histValues[key] ?? [];
          const hasHist = vals.length > 0;

          return (
            <div key={key}
              className={`bg-white border rounded-xl p-5 transition ${
                changed ? "border-blue-300 ring-1 ring-blue-200" : ""
              }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{label}</span>
                    {changed && (
                      <span className="text-xs text-blue-600 font-medium">modified</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <input
                    type="number"
                    value={values[key]}
                    min={min} max={max} step={step}
                    onChange={e => handleChange(key, e.target.value)}
                    className="w-20 p-2 text-sm border rounded-lg text-right
                               focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                  <span className="text-[10px] text-slate-400 text-right">{unit}</span>
                </div>
              </div>

              <input
                type="range"
                value={values[key]}
                min={min} max={max} step={step}
                onChange={e => handleChange(key, e.target.value)}
                className="w-full mt-3 accent-slate-700"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                <span>{min}</span>
                <span className="text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                  default: {DEFAULTS[key]}
                </span>
                <span>{max}</span>
              </div>

              {/* Impact histogram (direct-mapped thresholds only) */}
              {hasHist && (
                <ImpactHistogram
                  values={vals}
                  threshold={values[key]}
                  direction={WARN_DIRECTION[key]}
                  min={min}
                  max={max}
                />
              )}

              {/* Derived-metric note for rainfall / heat thresholds */}
              {!histKey && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-start gap-2">
                  <Info size={11} className="text-slate-400 mt-0.5 shrink-0" />
                  <span className="text-[10px] text-slate-400 leading-relaxed">
                    Derived metric - computed from live weather inputs at advisory time.
                    Historical advisory distribution is not available for this threshold.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white
                     rounded-lg font-medium hover:bg-slate-700 disabled:opacity-50 transition">
          <Save size={16} />
          {saving ? "Saving..." : "Save thresholds"}
        </button>
      </div>
    </div>
  );
}
