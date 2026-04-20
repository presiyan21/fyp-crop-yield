import { useEffect, useState } from "react";
import {
  Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Area, AreaChart,
} from "recharts";
import { TrendingUp, Loader2 } from "lucide-react";

async function fetchTrend(crop, distCode) {
  const res = await fetch(`/api/crops/${crop}/trend?dist_code=${distCode}`);
  if (!res.ok) throw new Error("Failed to fetch trend");
  const data = await res.json();
  return data.trend;
}

/** Ordinary Least Squares linear regression */
function computeOLS(data) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0 };
  const meanX = data.reduce((s, d) => s + d.year, 0) / n;
  const meanY = data.reduce((s, d) => s + d.yield_kg_ha, 0) / n;
  const num = data.reduce((s, d) => s + (d.year - meanX) * (d.yield_kg_ha - meanY), 0);
  const den = data.reduce((s, d) => s + (d.year - meanX) ** 2, 0);
  const slope = den !== 0 ? num / den : 0;
  return { slope, intercept: meanY - slope * meanX };
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const isPrediction = label === 2016;
  const actual = payload.find(p => p.dataKey === "yield_kg_ha")?.value;
  const trend  = payload.find(p => p.dataKey === "trendLine")?.value;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm text-xs space-y-0.5">
      <p className="font-semibold text-slate-700 mb-1">{isPrediction ? "Your prediction" : label}</p>
      {actual != null && (
        <p className="text-slate-600">Yield: <span className="font-medium">{actual.toLocaleString()}</span> Kg/ha</p>
      )}
      {trend != null && !isPrediction && (
        <p className="text-indigo-500">Trend: <span className="font-medium">{trend.toLocaleString()}</span> Kg/ha</p>
      )}
    </div>
  );
}

export default function YieldTrendChart({ crop, distCode, predictedYield }) {
  const [trend,   setTrend]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!crop || !distCode) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTrend(crop, Number(distCode));
        setTrend(data);
      } catch {
        setError("Could not load trend data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [crop, distCode]);

  if (!distCode) return null;
  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
      <Loader2 size={12} className="animate-spin" />
      Loading trend data…
    </div>
  );
  if (error || trend.length === 0) return null;

  // OLS regression over full 1966–2015 window
  const { slope, intercept } = computeOLS(trend);

  // Augment each data point with rolling avg + OLS trend value
  const withMetrics = trend.map((d, i) => {
    const window = trend.slice(Math.max(0, i - 4), i + 1);
    const avg    = window.reduce((s, x) => s + x.yield_kg_ha, 0) / window.length;
    return {
      ...d,
      rolling:   Math.round(avg),
      trendLine: Math.round(slope * d.year + intercept),
    };
  });

  // Extrapolate OLS to the prediction year
  const trendAt2016 = Math.round(slope * 2016 + intercept);

  const chartData = predictedYield
    ? [...withMetrics, {
        year:         2016,
        yield_kg_ha:  predictedYield,
        rolling:      predictedYield,
        trendLine:    trendAt2016,
        isPrediction: true,
      }]
    : withMetrics;

  // Header stats
  const firstVal   = trend[0]?.yield_kg_ha  || 0;
  const lastVal    = trend[trend.length - 1]?.yield_kg_ha || 0;
  const overallPct = firstVal > 0 ? Math.round(((lastVal - firstVal) / firstVal) * 100) : 0;
  const trendUp    = overallPct >= 0;

  const predVsTrend = predictedYield && trendAt2016 > 0
    ? Math.round(((predictedYield - trendAt2016) / trendAt2016) * 100)
    : null;

  return (
    <div className="mt-4 bg-white/60 rounded-lg p-3">

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={13} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">
            District historical yield (1966–2015)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className={`font-semibold ${trendUp ? "text-emerald-600" : "text-red-500"}`}>
            {trendUp ? "▲" : "▼"} {Math.abs(overallPct)}% over 50 years
          </span>
          <span className="text-slate-400">
            ({slope >= 0 ? "+" : ""}{Math.round(slope)} Kg/ha/yr)
          </span>
          {predVsTrend !== null && (
            <span className={`font-semibold ${predVsTrend >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              Prediction {predVsTrend >= 0 ? "+" : ""}{predVsTrend}% vs trend
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="yieldGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            axisLine={false} tickLine={false}
            tickFormatter={y => y === 2016 ? "Pred." : (y % 10 === 0 ? y : "")}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `${(v / 1000).toFixed(1)}k`}
          />
          <Tooltip content={<CustomTooltip />} />

          <Area
            type="monotone" dataKey="yield_kg_ha"
            stroke="#cbd5e1" strokeWidth={1}
            fill="url(#yieldGrad)"
            dot={false} activeDot={{ r: 3, fill: "#64748b" }}
          />

          <Line
            type="linear" dataKey="trendLine"
            stroke="#818cf8" strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false} activeDot={false}
          />

          <Line
            type="monotone" dataKey="rolling"
            stroke="#10b981" strokeWidth={2}
            dot={false} activeDot={false}
          />

          {/* Historical / prediction divider */}
          {predictedYield && (
            <ReferenceLine x={2015} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
          )}

          {predictedYield && (
            <Line
              type="monotone" dataKey="yield_kg_ha"
              stroke="transparent"
              dot={(props) => {
                const { cx, cy, payload } = props;
                if (!payload.isPrediction) return null;
                return (
                  <g key="pred-dot">
                    <circle cx={cx} cy={cy} r={7} fill="#1e293b" opacity={0.15} />
                    <circle cx={cx} cy={cy} r={4} fill="#1e293b" />
                  </g>
                );
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-1.5 text-[10px] text-slate-400 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-6 h-px bg-slate-300 inline-block" /> Annual yield
        </span>
        <span className="flex items-center gap-1">
          <svg width="20" height="6" style={{ display: "inline", verticalAlign: "middle" }}>
            <line x1="0" y1="3" x2="20" y2="3" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="4 2" />
          </svg>
          50-yr trend
        </span>
        <span className="flex items-center gap-1">
          <span className="w-6 h-0.5 bg-emerald-500 inline-block" /> 5-yr average
        </span>
        {predictedYield && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-800 inline-block" /> Your prediction
          </span>
        )}
      </div>

      {/* Trend insight callout */}
      {predVsTrend !== null && (
        <div className={`mt-2 text-[10px] px-2.5 py-1.5 rounded-md ${
          predVsTrend >= 0
            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
            : "bg-red-50 text-red-600 border border-red-100"
        }`}>
          Your prediction is{" "}
          <strong>{Math.abs(predVsTrend)}% {predVsTrend >= 0 ? "above" : "below"}</strong>{" "}
          the 50-year linear growth trend — the trend projects{" "}
          <strong>{trendAt2016.toLocaleString()} Kg/ha</strong> for this district.
        </div>
      )}
    </div>
  );
}
