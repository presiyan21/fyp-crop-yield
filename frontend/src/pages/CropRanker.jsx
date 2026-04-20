import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  FlaskConical, Loader2, Info, CloudSun, Sun, CloudRain,
  Thermometer, Snowflake, AlertTriangle, TrendingUp,
  TrendingDown, Minus, ChevronDown, ChevronUp, Sliders,
  RotateCcw, PenLine,
} from "lucide-react";
import { fetchCropDistricts, rankCrops, fetchDistrictWeather } from "../lib/api";

const WEATHER_INPUTS = [
  { key: "ANNUAL RAINFALL (Millimeters)", label: "Annual Rainfall",  unit: "mm",   min: 200, max: 3000, step: 10,  def: 900  },
  { key: "KHARIF_TMAX",                  label: "Kharif Max Temp",   unit: "°C", min: 25,  max: 48,   step: 0.5, def: 34   },
  { key: "RABI_TMIN",                    label: "Rabi Min Temp",     unit: "°C", min: -2,  max: 22,   step: 0.5, def: 10   },
];
const MGMT_INPUTS = [
  { key: "IRRIGATION_RATIO",     label: "Irrigation Ratio", unit: "0-1",   min: 0,   max: 1,   step: 0.05, def: 0.35 },
  { key: "NPK_TOTAL_KG_PER_HA", label: "NPK Fertiliser",   unit: "kg/ha", min: 0,   max: 400, step: 5,    def: 80   },
];

const PRESETS = [
  {
    id: "drought", label: "Drought", icon: Sun,
    desc: "Monsoon failure: 30% less rainfall",
    apply: w => ({ ...w, "ANNUAL RAINFALL (Millimeters)": Math.round(w["ANNUAL RAINFALL (Millimeters)"] * 0.7) }),
  },
  {
    id: "excess_rain", label: "Excess Rain", icon: CloudRain,
    desc: "Heavy monsoon: 40% more rainfall",
    apply: w => ({ ...w, "ANNUAL RAINFALL (Millimeters)": Math.round(w["ANNUAL RAINFALL (Millimeters)"] * 1.4) }),
  },
  {
    id: "heat_wave", label: "Heat Wave", icon: Thermometer,
    desc: "Extreme Kharif: +3°C peak temperature",
    apply: w => ({ ...w, KHARIF_TMAX: Math.round((w.KHARIF_TMAX + 3) * 10) / 10 }),
  },
  {
    id: "cold_snap", label: "Cold Snap", icon: Snowflake,
    desc: "Harsh Rabi winter: -4°C minimum",
    apply: w => ({ ...w, RABI_TMIN: Math.round((w.RABI_TMIN - 4) * 10) / 10 }),
  },
  {
    id: "compound", label: "Compound Stress", icon: AlertTriangle,
    desc: "Drought + Heat: -25% rain, +2°C",
    apply: w => ({
      ...w,
      "ANNUAL RAINFALL (Millimeters)": Math.round(w["ANNUAL RAINFALL (Millimeters)"] * 0.75),
      KHARIF_TMAX: Math.round((w.KHARIF_TMAX + 2) * 10) / 10,
    }),
  },
  {
    id: "custom", label: "Custom Scenario", icon: PenLine,
    desc: "Define your own climate conditions manually",
    apply: w => ({ ...w }),
  },
];

const cap = s => s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ");
const fmtPct = v => (v > 0 ? "+" : "") + v + "%";

const impactColor = pct => {
  if (pct > 5)   return "#059669";
  if (pct > -2)  return "#22c55e";
  if (pct > -10) return "#f59e0b";
  return "#ef4444";
};
const resilienceClass = pct => {
  if (pct > 5)   return { label: "Benefits",        bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" };
  if (pct > -2)  return { label: "Stable",           bg: "bg-green-50 border-green-200",     text: "text-green-700"   };
  if (pct > -10) return { label: "Moderate impact",   bg: "bg-amber-50 border-amber-200",     text: "text-amber-700"   };
  return           { label: "Vulnerable",        bg: "bg-red-50 border-red-200",         text: "text-red-700"     };
};

const LEVEL_BG   = { green: "bg-green-50 border-green-200", amber: "bg-amber-50 border-amber-200", red: "bg-red-50 border-red-200" };
const LEVEL_TEXT  = { green: "text-green-700", amber: "text-amber-700", red: "text-red-700" };

function ImpactTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rc = resilienceClass(d.yieldChangePct);
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-sm max-w-xs">
      <p className="font-semibold capitalize">{cap(d.crop)}</p>
      <p className="text-slate-500 mt-1">Baseline: {d.baseYield.toLocaleString()} kg/ha (Rank #{d.baseRank})</p>
      <p className="text-slate-500">Scenario: {d.scenYield.toLocaleString()} kg/ha (Rank #{d.scenRank})</p>
      <p className={"font-semibold mt-1 " + rc.text}>{fmtPct(d.yieldChangePct)} {" - "} {rc.label}</p>
    </div>
  );
}

export default function CropRanker() {
  const navigate = useNavigate();

  const [districts, setDistricts]   = useState([]);
  const [distCode, setDistCode]     = useState("");
  const [distSearch, setDistSearch] = useState("");

  const [weather, setWeather] = useState(
    Object.fromEntries(WEATHER_INPUTS.map(i => [i.key, i.def]))
  );
  const [management, setManagement] = useState(
    Object.fromEntries(MGMT_INPUTS.map(i => [i.key, i.def]))
  );
  const [weatherFields, setWeatherFields] = useState(new Set());
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [mgmtOpen, setMgmtOpen] = useState(false);

  const [selectedPreset, setSelectedPreset] = useState(null);
  const [scenarioWeather, setScenarioWeather] = useState(null);

  const [baselineRanked, setBaselineRanked] = useState(null);
  const [scenarioRanked, setScenarioRanked] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    fetchCropDistricts("rice").then(setDistricts).catch(() => {});
  }, []);

  useEffect(() => {
    if (!distCode) { setWeatherFields(new Set()); return; }
    let cancelled = false;
    (async () => {
      setWeatherLoading(true);
      try {
        const w = await fetchDistrictWeather(Number(distCode));
        if (cancelled || !w) return;
        const filled = new Set();
        const patch = {};
        if (w.annual_rainfall_mm != null) { patch["ANNUAL RAINFALL (Millimeters)"] = Math.round(w.annual_rainfall_mm); filled.add("ANNUAL RAINFALL (Millimeters)"); }
        if (w.kharif_tmax != null)        { patch.KHARIF_TMAX = Math.round(w.kharif_tmax * 10) / 10;                   filled.add("KHARIF_TMAX"); }
        if (w.rabi_tmin != null)          { patch.RABI_TMIN   = Math.round(w.rabi_tmin * 10) / 10;                      filled.add("RABI_TMIN"); }
        setWeather(prev => ({ ...prev, ...patch }));
        setWeatherFields(filled);
      } catch { /* silent */ }
      finally { if (!cancelled) setWeatherLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [distCode]);

  function selectPreset(id) {
    if (selectedPreset === id) {
      setSelectedPreset(null);
      setScenarioWeather(null);
      setBaselineRanked(null);
      setScenarioRanked(null);
      return;
    }
    setSelectedPreset(id);
    const preset = PRESETS.find(p => p.id === id);
    if (preset) setScenarioWeather(preset.apply(weather));
  }

  useEffect(() => {
    if (!scenarioWeather || !selectedPreset) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const baseFeats = { ...weather, ...management };
      const scenFeats = { ...scenarioWeather, ...management };
      const dc = distCode ? Number(distCode) : null;
      setLoading(true);
      setError(null);
      try {
        const [bRes, sRes] = await Promise.all([
          rankCrops(baseFeats, dc),
          rankCrops(scenFeats, dc),
        ]);
        setBaselineRanked(bRes.ranked);
        setScenarioRanked(sRes.ranked);
      } catch {
        setError("Failed to compare scenarios. Check that the backend is running.");
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [scenarioWeather, weather, management, distCode, selectedPreset]);

  const comparison = useMemo(() => {
    if (!baselineRanked || !scenarioRanked) return null;
    const bSorted = [...baselineRanked].sort((a, b) => b.delta_pct - a.delta_pct);
    const sSorted = [...scenarioRanked].sort((a, b) => b.delta_pct - a.delta_pct);
    return bSorted.map((b, bIdx) => {
      const sIdx = sSorted.findIndex(s => s.crop === b.crop);
      const s = sSorted[sIdx];
      const ycp = (s.predicted_yield - b.predicted_yield) / b.predicted_yield * 100;
      return {
        crop: b.crop, baseYield: b.predicted_yield, scenYield: s.predicted_yield,
        baseLevel: b.level, scenLevel: s.level,
        baseRank: bIdx + 1, scenRank: sIdx + 1,
        rankChange: (bIdx + 1) - (sIdx + 1),
        yieldChangePct: Math.round(ycp * 10) / 10,
        hist_median: b.hist_median,
      };
    });
  }, [baselineRanked, scenarioRanked]);

  const impactSorted = useMemo(
    () => comparison ? [...comparison].sort((a, b) => b.yieldChangePct - a.yieldChangePct) : null,
    [comparison]
  );

  const modifications = useMemo(() => {
    if (!scenarioWeather) return [];
    return WEATHER_INPUTS.filter(i => weather[i.key] !== scenarioWeather[i.key]).map(i => ({
      label: i.label, unit: i.unit,
      baseline: weather[i.key],
      scenario: scenarioWeather[i.key],
      changePct: Math.round(((scenarioWeather[i.key] - weather[i.key]) / (weather[i.key] || 1)) * 100),
    }));
  }, [scenarioWeather, weather]);

  const finding = useMemo(() => {
    if (!impactSorted || !selectedPreset) return null;
    const preset = PRESETS.find(p => p.id === selectedPreset);
    const pLabel = selectedPreset === "custom" ? "custom" : (preset?.label?.toLowerCase() || "scenario");
    const best = impactSorted[0];
    const worst = impactSorted[impactSorted.length - 1];
    if (worst.yieldChangePct >= -2) {
      return "Under " + pLabel + " conditions, all crops remain relatively stable. " + cap(best.crop) + " responds most positively (" + fmtPct(best.yieldChangePct) + ").";
    }
    return "Under " + pLabel + " conditions, " + cap(best.crop) + " is most resilient (" + fmtPct(best.yieldChangePct) + ") while " + cap(worst.crop) + " is most vulnerable (" + fmtPct(worst.yieldChangePct) + ").";
  }, [impactSorted, selectedPreset]);

  const modestImpact = useMemo(() => {
    if (!impactSorted || !selectedPreset || selectedPreset === "custom") return false;
    return Math.max(...impactSorted.map(i => Math.abs(i.yieldChangePct))) < 5;
  }, [impactSorted, selectedPreset]);

  const selectedDist = districts.find(d => String(d.code) === String(distCode));
  const filteredDistricts = districts.filter(d => {
    const q = distSearch.toLowerCase();
    return d.name?.toLowerCase().includes(q) || d.state?.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FlaskConical size={24} className="text-violet-500" />
          Climate Resilience Planner
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Compare how all 10 crops respond to climate stress. Identify which crops
          survive drought, heat waves, or compound scenarios and which collapse.
          Uses 20 model inferences (baseline + scenario) in parallel.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-slate-800 text-sm">District (optional)</h2>
            <input type="text" placeholder="Search district or state..."
              value={distSearch} onChange={e => setDistSearch(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            {(distSearch || !distCode) && (
              <select value={distCode}
                onChange={e => { setDistCode(e.target.value); setDistSearch(""); }}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                size={Math.min(7, filteredDistricts.length + 1)}>
                <option value="">-- National average --</option>
                {filteredDistricts.map(d => (
                  <option key={d.code} value={d.code}>{d.name} ({d.state})</option>
                ))}
              </select>
            )}
            {distCode && !distSearch && selectedDist && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">{selectedDist.name}</span>
                <button onClick={() => { setDistCode(""); setWeatherFields(new Set()); }}
                  className="text-xs text-slate-400 hover:text-red-500">Clear</button>
              </div>
            )}
            {weatherLoading && (
              <p className="text-xs text-sky-600 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Fetching live weather...
              </p>
            )}
            {!weatherLoading && weatherFields.size > 0 && selectedDist && (
              <p className="text-xs text-sky-600 flex items-center gap-1">
                <CloudSun size={12} /> Baseline weather from Open-Meteo for {selectedDist.name}
              </p>
            )}
          </div>

          {/* Baseline weather */}
          <div className="bg-white border rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                <CloudSun size={14} className="text-sky-500" /> Baseline Weather
              </h2>
              <button onClick={() => { setWeather(Object.fromEntries(WEATHER_INPUTS.map(i => [i.key, i.def]))); setWeatherFields(new Set()); }}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <RotateCcw size={12} /> Reset
              </button>
            </div>
            {WEATHER_INPUTS.map(inp => {
              const filled = weatherFields.has(inp.key);
              return (
                <div key={inp.key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 flex items-center gap-1.5">
                      {inp.label}
                      {filled && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">
                          <CloudSun size={10} /> Live
                        </span>
                      )}
                    </span>
                    <span className="font-mono font-medium text-slate-900">
                      {weather[inp.key]}<span className="text-slate-400 text-xs ml-1">{inp.unit}</span>
                    </span>
                  </div>
                  <input type="range" min={inp.min} max={inp.max} step={inp.step}
                    value={weather[inp.key]}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setWeather(prev => ({ ...prev, [inp.key]: val }));
                      if (filled) setWeatherFields(prev => { const n = new Set(prev); n.delete(inp.key); return n; });
                    }}
                    className="w-full accent-violet-600" />
                  <div className="flex justify-between text-xs text-slate-300 mt-0.5">
                    <span>{inp.min}</span><span>{inp.max}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Scenario presets */}
          <div className="bg-white border rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
              <FlaskConical size={14} className="text-violet-500" /> Climate Scenario
            </h2>
            <p className="text-xs text-slate-400">
              Select a preset to start, then fine-tune scenario values below.
            </p>
            <div className="space-y-2">
              {PRESETS.map(p => {
                const Icon = p.icon;
                const active = selectedPreset === p.id;
                return (
                  <button key={p.id}
                    onClick={() => selectPreset(p.id)}
                    className={"w-full text-left px-3 py-2.5 rounded-lg border text-sm transition flex items-start gap-2.5 "
                      + (active
                        ? "bg-violet-50 border-violet-300 ring-2 ring-violet-200"
                        : "border-slate-200 hover:border-violet-200 hover:bg-slate-50")}>
                    <Icon size={16} className={"mt-0.5 shrink-0 " + (active ? "text-violet-600" : "text-slate-400")} />
                    <div>
                      <span className={"font-medium " + (active ? "text-violet-700" : "text-slate-700")}>{p.label}</span>
                      <span className="block text-xs text-slate-400 mt-0.5">{p.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editable scenario weather */}
          {scenarioWeather && selectedPreset && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-violet-800 text-sm flex items-center gap-1.5">
                  <FlaskConical size={14} className="text-violet-500" /> Scenario Weather (editable)
                </h2>
                <button onClick={() => {
                  const preset = PRESETS.find(p => p.id === selectedPreset);
                  if (preset) setScenarioWeather(preset.apply(weather));
                }}
                  className="text-xs text-violet-400 hover:text-violet-600 flex items-center gap-1">
                  <RotateCcw size={12} /> Reset to preset
                </button>
              </div>
              {WEATHER_INPUTS.map(inp => {
                const baseVal = weather[inp.key];
                const scenVal = scenarioWeather[inp.key];
                const diff = scenVal - baseVal;
                const diffPct = baseVal ? Math.round((diff / baseVal) * 100) : 0;
                const changed = Math.abs(diff) > 0.01;
                return (
                  <div key={inp.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-violet-700">{inp.label}</span>
                      <span className="font-mono font-medium text-violet-900 flex items-center gap-2">
                        {scenVal}
                        <span className="text-violet-400 text-xs">{inp.unit}</span>
                        {changed && (
                          <span className={"text-xs font-semibold " + (diff > 0 ? "text-red-500" : "text-blue-500")}>
                            ({diff > 0 ? "+" : ""}{Math.round(diff * 10) / 10})
                          </span>
                        )}
                      </span>
                    </div>
                    <input type="range" min={inp.min} max={inp.max} step={inp.step}
                      value={scenVal}
                      onChange={e => setScenarioWeather(prev => ({ ...prev, [inp.key]: Number(e.target.value) }))}
                      className="w-full accent-violet-600" />
                    <div className="flex justify-between text-xs text-violet-300 mt-0.5">
                      <span>{inp.min}</span>
                      {changed && (
                        <span className="text-violet-400">
                          Baseline: {baseVal} ({diffPct > 0 ? "+" : ""}{diffPct}%)
                        </span>
                      )}
                      <span>{inp.max}</span>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-violet-400 flex items-start gap-1">
                <Info size={12} className="mt-0.5 shrink-0" />
                Adjust sliders to fine-tune the scenario. Results update live.
                Management inputs stay constant across both scenarios.
              </p>
            </div>
          )}

          {/* Management (collapsible) */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <button onClick={() => setMgmtOpen(!mgmtOpen)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-800 hover:bg-slate-50 transition">
              <span className="flex items-center gap-1.5">
                <Sliders size={14} className="text-violet-500" /> Management Inputs
              </span>
              {mgmtOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {mgmtOpen && (
              <div className="px-4 pb-4 space-y-4 border-t pt-3">
                {MGMT_INPUTS.map(inp => (
                  <div key={inp.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">{inp.label}</span>
                      <span className="font-mono font-medium text-slate-900">
                        {management[inp.key]}<span className="text-slate-400 text-xs ml-1">{inp.unit}</span>
                      </span>
                    </div>
                    <input type="range" min={inp.min} max={inp.max} step={inp.step}
                      value={management[inp.key]}
                      onChange={e => setManagement(prev => ({ ...prev, [inp.key]: Number(e.target.value) }))}
                      className="w-full accent-violet-600" />
                    <div className="flex justify-between text-xs text-slate-300 mt-0.5">
                      <span>{inp.min}</span><span>{inp.max}</span>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-400 flex items-start gap-1">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  Management inputs are held constant across both scenarios so
                  the comparison isolates climate impact only.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* RIGHT: Results */}
        <div className="lg:col-span-2 space-y-4">
          {!comparison && !loading && (
            <div className="bg-white border rounded-xl p-16 text-center text-slate-400">
              <FlaskConical size={44} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium text-slate-600">Select a climate scenario to begin</p>
              <p className="text-sm mt-1">
                {distCode
                  ? "Pick a scenario from the left to compare crop resilience."
                  : "Optionally select a district for live weather, then pick a scenario."}
              </p>
            </div>
          )}

          {loading && !comparison && (
            <div className="bg-white border rounded-xl p-16 text-center text-slate-400">
              <Loader2 size={44} className="mx-auto mb-3 animate-spin opacity-30" />
              <p className="font-medium text-slate-600">Running 20 model inferences...</p>
            </div>
          )}

          {comparison && (
            <div className={"space-y-4 " + (loading ? "opacity-60 pointer-events-none" : "")}>
              {/* Scenario strip */}
              {modifications.length > 0 && (
                <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-start gap-3">
                  {(() => { const P = PRESETS.find(p => p.id === selectedPreset); const I = P?.icon; return I ? <I size={18} className="text-violet-600 mt-0.5 shrink-0" /> : null; })()}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-violet-800">
                      {PRESETS.find(p => p.id === selectedPreset)?.label}
                      {selectedDist ? " - " + selectedDist.name : ""}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {modifications.map(m => (
                        <span key={m.label} className="text-xs text-violet-700">
                          {m.label}: <span className="font-mono">{m.baseline.toLocaleString()}</span>
                          {" -> "}
                          <span className="font-mono font-semibold">{m.scenario.toLocaleString()}</span>
                          <span className="text-violet-400 ml-1">({fmtPct(m.changePct)})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {loading && <Loader2 size={16} className="animate-spin text-violet-400 shrink-0 mt-0.5" />}
                </div>
              )}

              {/* Key finding */}
              {finding && (
                <div className="bg-gradient-to-r from-slate-50 to-violet-50 border rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800 flex items-start gap-2">
                    <Info size={16} className="text-violet-500 mt-0.5 shrink-0" />
                    {finding}
                  </p>
                </div>
              )}

              {/* Modest impact insight */}
              {modestImpact && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
                  <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-800 mb-0.5">Crops are resilient under this scenario</p>
                    <p className="text-xs text-blue-700 leading-relaxed">
                      All crops stay within 5% of their normal yields â€” your district's irrigation and farming inputs are providing strong protection against this level of weather stress. For a more demanding test, try <span className="font-medium">Compound Stress</span> to see which crops hold up under combined drought and heat.
                    </p>
                  </div>
                </div>
              )}

              {/* Impact chart */}
              <div className="bg-white border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-1">
                  Yield Impact per Crop
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  Percentage change from baseline. Green = resilient, red = vulnerable.
                </p>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={impactSorted} layout="vertical" margin={{ left: 90, right: 50, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }}
                      tickFormatter={v => (v > 0 ? "+" : "") + v + "%"}
                      domain={["dataMin", "dataMax"]} />
                    <YAxis type="category" dataKey="crop" width={85} tick={{ fontSize: 12 }}
                      tickFormatter={v => cap(v)} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} />
                    <Tooltip content={<ImpactTooltip />} />
                    <Bar dataKey="yieldChangePct" name="Yield Change" radius={[3, 3, 3, 3]} barSize={18}>
                      {impactSorted.map((item, i) => (
                        <Cell key={i} fill={impactColor(item.yieldChangePct)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Crop cards */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Detailed Comparison</h3>
                <div className="space-y-2">
                  {impactSorted.map(item => (
                    <CropRow key={item.crop} data={item}
                      onAdvisory={() => navigate("/dashboard?crop=" + item.crop + (distCode ? "&dist=" + distCode : ""))} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CropRow({ data, onAdvisory }) {
  const { crop, baseYield, scenYield, baseLevel, scenLevel,
          rankChange, yieldChangePct } = data;
  const rc = resilienceClass(yieldChangePct);

  return (
    <div className="bg-white border rounded-xl px-4 py-3 flex items-center gap-4 hover:border-slate-300 transition">
      <span className={"shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap " + rc.bg + " " + rc.text}>
        {rc.label}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-900 capitalize">{cap(crop)}</span>
          {rankChange !== 0 && (
            <span className={"flex items-center gap-0.5 text-xs font-medium "
              + (rankChange > 0 ? "text-green-600" : "text-red-600")}>
              {rankChange > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {rankChange > 0 ? "Up " + rankChange : "Down " + Math.abs(rankChange)}
              {Math.abs(rankChange) === 1 ? " rank" : " ranks"}
            </span>
          )}
          <span className={"text-sm font-bold " + rc.text}>{fmtPct(yieldChangePct)}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
          <span className="flex items-center gap-1">
            Baseline: <span className="font-semibold text-slate-700">{baseYield.toLocaleString()}</span>
            <span className={"px-1.5 py-0.5 rounded text-[10px] font-medium border " + LEVEL_BG[baseLevel] + " " + LEVEL_TEXT[baseLevel]}>{baseLevel}</span>
          </span>
          <span className="text-slate-300">|</span>
          <span className="flex items-center gap-1">
            Scenario: <span className="font-semibold text-slate-700">{scenYield.toLocaleString()}</span>
            <span className={"px-1.5 py-0.5 rounded text-[10px] font-medium border " + LEVEL_BG[scenLevel] + " " + LEVEL_TEXT[scenLevel]}>{scenLevel}</span>
          </span>
        </div>
      </div>

      <button onClick={onAdvisory}
        className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
        Get Advisory
      </button>
    </div>
  );
}
