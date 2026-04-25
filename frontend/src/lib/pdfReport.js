import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { getFeatureLabel, getConfidenceTier } from "./featureLabels";

const MSP_PER_QUINTAL = {
  rice: 2300, wheat: 2275, maize: 2090, sorghum: 3371,
  pearl_millet: 2500, chickpea: 5440, pigeonpea: 7000,
  groundnut: 6377, cotton: 7121, sugarcane: 340,
};
const XGB_R2 = {
  rice: 0.821, wheat: 0.813, maize: 0.688, sorghum: 0.426,
  pearl_millet: 0.448, chickpea: 0.436, pigeonpea: 0.462,
  groundnut: 0.476, cotton: 0.424, sugarcane: 0.673,
};
const XGB_RMSE = {
  rice: 410.6, wheat: 454.8, maize: 844.7, sorghum: 425.7,
  pearl_millet: 465.9, chickpea: 266.6, pigeonpea: 285.5,
  groundnut: 446.3, cotton: 154.7, sugarcane: 1556.7,
};
const LEVEL_COLOR = { green: "#059669", amber: "#d97706", red: "#dc2626" };
const LEVEL_BG    = { green: "#ecfdf5", amber: "#fffbeb", red: "#fef2f2" };
const CONF_COLOR  = { emerald: "#059669", amber: "#d97706", red: "#dc2626" };

function fmtRupee(n) {
  return "\u20B9" + Math.round(n).toLocaleString("en-IN");
}

function buildReportHTML(advisory) {
  const r2         = XGB_R2[advisory.crop]   || 0;
  const rmse       = XGB_RMSE[advisory.crop] || 0;
  const confidence = getConfidenceTier(r2);
  const cropLabel  = advisory.crop.replace(/_/g, " ");
  const levelColor = LEVEL_COLOR[advisory.level] || "#d97706";
  const levelBg    = LEVEL_BG[advisory.level]    || "#fffbeb";
  const confColor  = CONF_COLOR[confidence.colour] || "#d97706";

  const ci       = advisory.conformal_interval;
  const predLow  = ci ? Math.max(0, ci.lower_90) : Math.max(0, advisory.predicted_yield - rmse);
  const predHigh = ci ? ci.upper_90 : advisory.predicted_yield + rmse;
  const ciHalf   = ci ? ci.q90 : rmse;
  const ciLabel  = ci
    ? `90% interval (n=${ci.n_calibration} test obs.)`
    : "RMSE estimate";

  const { hist_q25, hist_median, hist_q75, predicted_yield } = advisory;
  const range    = hist_q75 - hist_q25;
  const pad      = range * 0.35;
  const scaleMin = Math.max(0, hist_q25 - pad);
  const scaleMax = hist_q75 + pad;
  const tot      = scaleMax - scaleMin;
  const clamp    = v => Math.max(scaleMin, Math.min(scaleMax, v));
  const pct      = v => ((clamp(v) - scaleMin) / tot * 100).toFixed(2);
  const q25Pct   = pct(hist_q25);
  const medPct   = pct(hist_median);
  const q75Pct   = pct(hist_q75);
  const predPct  = pct(predicted_yield);

  const diff      = predicted_yield - hist_median;
  const diffSign  = diff >= 0 ? "+" : "";
  const diffColor = diff >= 0 ? "#059669" : "#dc2626";

  const msp            = MSP_PER_QUINTAL[advisory.crop];
  const revenue        = msp ? (predicted_yield / 100) * msp        : null;
  const revenueMedian  = msp ? (hist_median    / 100) * msp        : null;
  const delta          = revenue != null ? revenue - revenueMedian  : null;

  const shapEntries = advisory.shap_top10
    ? Object.entries(advisory.shap_top10).sort(([, a], [, b]) => b - a).slice(0, 5)
    : [];
  const maxShap = shapEntries[0]?.[1] || 1;

  const seasonHTML = (() => {
    const sc    = advisory._seasonConditions;
    const score = advisory.season_score;
    const overall = sc?.overall
      || (score === 100 ? "favourable" : score === 50 ? "mixed" : score === 0 ? "challenging" : null);
    if (!overall) return "";
    const scCfg = {
      favourable:  { bg: "#ecfdf5", color: "#065f46", label: "Favourable season conditions" },
      mixed:       { bg: "#fffbeb", color: "#92400e", label: "Mixed season conditions"      },
      challenging: { bg: "#fef2f2", color: "#991b1b", label: "Challenging season conditions" },
    }[overall];
    if (!scCfg) return "";
    const driverText = sc?.key_driver_label && sc?.key_driver_diff
      ? ` &nbsp;&middot;&nbsp; Key driver: ${sc.key_driver_label} ${sc.key_driver_diff}` : "";
    return `<div style="margin-top:8px;"><span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:12px;background:${scCfg.bg};color:${scCfg.color};">&#127807; ${scCfg.label}${driverText}</span><div style="font-size:9px;color:#94a3b8;margin-top:2px;">vs. this crop&#39;s 1966&ndash;2005 training distribution</div></div>`;
  })();

  const shapRows = shapEntries.map(([f, v]) => {
    const barPct = ((v / maxShap) * 100).toFixed(1);
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
      <div style="width:160px;font-size:11px;color:#374151;text-align:right;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${getFeatureLabel(f)}</div>
      <div style="flex:1;background:#e5e7eb;border-radius:4px;height:11px;overflow:hidden;">
        <div style="width:${barPct}%;height:100%;background:#6366f1;border-radius:4px;"></div>
      </div>
      <div style="width:34px;font-size:10px;color:#6b7280;text-align:right;">${v.toFixed(0)}</div>
    </div>`;
  }).join("");

  const actionsHTML = (advisory.actions || []).map(a =>
    `<div style="display:flex;align-items:flex-start;gap:7px;margin-bottom:6px;">
      <span style="color:#9ca3af;flex-shrink:0;margin-top:1px;">&#8226;</span>
      <span style="font-size:11.5px;color:#374151;line-height:1.55;">${a}</span>
    </div>`
  ).join("");

  const oodHTML = advisory.ood_warnings?.length > 0
    ? `<div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:5px;">&#9888; Input outside training range</div>
        ${advisory.ood_warnings.map(w => `<div style="font-size:10px;color:#92400e;line-height:1.5;">&#8226; ${w}</div>`).join("")}
      </div>`
    : "";

  const now = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  return `<div style="font-family:system-ui,-apple-system,sans-serif;width:700px;padding:28px 36px;background:#fff;color:#1e293b;box-sizing:border-box;">

  <!-- HEADER -->
  <div class="pdf-section"><div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:2.5px solid #e2e8f0;margin-bottom:14px;">
    <div>
      <div style="font-size:24px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">&#127807; CropAdvisor</div>
      <div style="font-size:12px;color:#64748b;margin-top:3px;">Crop Yield Advisory Report</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Generated</div>
      <div style="font-size:12px;font-weight:700;color:#475569;margin-top:2px;">${now}</div>
      ${advisory.district_name
        ? `<div style="font-size:11px;color:#64748b;margin-top:4px;">&#128205; ${advisory.district_name}</div>`
        : ""}
    </div>
  </div>

  <!-- LEVEL BANNER -->
  <div style="background:${levelBg};border:2px solid ${levelColor}33;border-radius:12px;padding:12px 16px;margin-bottom:12px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
      <span style="background:${levelColor};color:#fff;font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;letter-spacing:0.08em;">${advisory.level.toUpperCase()}</span>
      <span style="font-size:11px;color:#64748b;text-transform:capitalize;">${cropLabel}</span>
      <span style="font-size:11px;font-weight:600;color:${confColor};">${confidence.label} Confidence</span>
    </div>
    <div style="font-size:15.5px;font-weight:700;color:${levelColor};line-height:1.4;">${advisory.headline}</div>
    ${seasonHTML}
  </div>
  </div>

  ${oodHTML ? `<div class="pdf-section">${oodHTML}</div>` : ""}

  <!-- YIELD GAUGE -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin-bottom:12px;">
    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Predicted Yield</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
      <div>
        <span style="font-size:24px;font-weight:800;color:#1e293b;">${predicted_yield.toLocaleString()}</span>
        <span style="font-size:12px;color:#64748b;margin-left:5px;">Kg/ha</span>
      </div>
      <span style="font-size:13px;font-weight:700;color:${diffColor};">${diffSign}${diff.toFixed(0)} vs district median</span>
    </div>

    <!-- Bar -->
    <div style="position:relative;height:16px;border-radius:8px;overflow:hidden;background:#e2e8f0;margin-bottom:8px;">
      <div style="position:absolute;height:100%;background:#fca5a5;left:0;width:${q25Pct}%;"></div>
      <div style="position:absolute;height:100%;background:#fcd34d;left:${q25Pct}%;width:${medPct - q25Pct}%;"></div>
      <div style="position:absolute;height:100%;background:#6ee7b7;left:${medPct}%;width:${q75Pct - medPct}%;"></div>
      <div style="position:absolute;height:100%;background:#a7f3d0;left:${q75Pct}%;right:0;"></div>
      <div style="position:absolute;top:0;width:2.5px;height:100%;background:#475569;left:${medPct}%;"></div>
      <div style="position:absolute;top:0;left:${predPct}%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:10px solid #1e293b;"></div>
    </div>

    <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;margin-bottom:6px;">
      <span>Q25: ${hist_q25.toLocaleString()}</span>
      <span style="font-weight:700;color:#64748b;">Median: ${hist_median.toLocaleString()}</span>
      <span>Q75: ${hist_q75.toLocaleString()}</span>
    </div>
    <div style="font-size:10px;color:#94a3b8;">Confidence range: ${predLow.toFixed(0)}&nbsp;&ndash;&nbsp;${predHigh.toFixed(0)} Kg/ha &mdash; ${ciLabel}</div>
  </div>

  <!-- RECOMMENDATIONS -->
  ${actionsHTML
    ? `<div style="margin-bottom:12px;">
        <div style="font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Recommendations</div>
        ${actionsHTML}
      </div>`
    : ""}

  <!-- METRICS ROW -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
    <div style="background:#f1f5f9;border-radius:8px;padding:8px 10px;text-align:center;">
      <div style="font-size:17px;font-weight:800;color:#1e293b;">${(r2 * 100).toFixed(1)}%</div>
      <div style="font-size:9px;color:#94a3b8;margin-top:2px;">Model R&sup2; accuracy</div>
    </div>
    <div style="background:#f1f5f9;border-radius:8px;padding:8px 10px;text-align:center;">
      <div style="font-size:17px;font-weight:800;color:#1e293b;">&plusmn;${rmse.toFixed(0)}</div>
      <div style="font-size:9px;color:#94a3b8;margin-top:2px;">Typical error (Kg/ha)</div>
    </div>
    <div style="background:#f1f5f9;border-radius:8px;padding:8px 10px;text-align:center;">
      <div style="font-size:12px;font-weight:800;color:#1e293b;">${predLow.toFixed(0)}&nbsp;&ndash;&nbsp;${predHigh.toFixed(0)}</div>
      <div style="font-size:9px;color:#94a3b8;margin-top:2px;">Yield range (Kg/ha)</div>
    </div>
  </div>

  <!-- ECONOMIC IMPACT -->
  ${revenue != null
    ? `<div style="background:#ecfdf5;border:1.5px solid #a7f3d0;border-radius:12px;padding:10px 16px;margin-bottom:12px;">
        <div style="font-size:10px;font-weight:800;color:#065f46;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Economic Impact &mdash; MSP Based</div>
        <div style="display:flex;gap:32px;">
          <div>
            <div style="font-size:17px;font-weight:800;color:#065f46;">${fmtRupee(revenue)}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:2px;">Estimated revenue / ha</div>
          </div>
          <div>
            <div style="font-size:17px;font-weight:800;color:${delta >= 0 ? "#065f46" : "#dc2626"};">${delta >= 0 ? "+" : ""}${fmtRupee(delta)}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:2px;">vs district median</div>
          </div>
        </div>
        <div style="font-size:10px;color:#6b7280;margin-top:8px;">Based on GoI 2024&ndash;25 MSP of &#8377;${msp}/quintal for ${cropLabel}. Actual market prices may differ.</div>
      </div>`
    : ""}

    <!-- MONTE CARLO UNCERTAINTY (when mcData provided) -->
  ${advisory._mcData
    ? (() => {
        const mc = advisory._mcData;
        const lp = mc.level_probabilities || {};
        const nonRedPct = (lp.green || 0) + (lp.amber || 0);
        const pillStyle = (bg, color) => `display:inline-block;font-size:10px;font-weight:700;padding:3px 10px;border-radius:12px;background:${bg};color:${color};margin-right:6px;`;
        return `
  <div style="background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:10px 16px;margin-bottom:12px;">
    <div style="font-size:10px;font-weight:800;color:#4c1d95;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">&#127922; Weather Uncertainty &mdash; Monte Carlo (${mc.n_simulations.toLocaleString()} simulations)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
      <div style="background:white;border-radius:6px;padding:6px 8px;text-align:center;border:1px solid #ede9fe;">
        <div style="font-size:9px;color:#94a3b8;margin-bottom:1px;">Worst likely (P10)</div>
        <div style="font-size:14px;font-weight:800;color:#1e293b;">${Math.round(mc.p10).toLocaleString()}</div>
      </div>
      <div style="background:white;border-radius:6px;padding:6px 8px;text-align:center;border:1px solid #ede9fe;">
        <div style="font-size:9px;color:#94a3b8;margin-bottom:1px;">Median (P50)</div>
        <div style="font-size:14px;font-weight:800;color:#5b21b6;">${Math.round(mc.p50).toLocaleString()}</div>
      </div>
      <div style="background:white;border-radius:8px;padding:9px 10px;text-align:center;border:1px solid #ede9fe;">
        <div style="font-size:9px;color:#94a3b8;margin-bottom:1px;">Best likely (P90)</div>
        <div style="font-size:14px;font-weight:800;color:#1e293b;">${Math.round(mc.p90).toLocaleString()}</div>
      </div>
      <div style="background:white;border-radius:8px;padding:9px 10px;text-align:center;border:1px solid #ede9fe;">
        <div style="font-size:9px;color:#94a3b8;margin-bottom:1px;">IQR spread</div>
        <div style="font-size:14px;font-weight:800;color:#1e293b;">${Math.round(mc.iqr).toLocaleString()}</div>
      </div>
    </div>
    <div style="margin-bottom:10px;">
      ${lp.green ? `<span style="${pillStyle("#ecfdf5", "#065f46")}">${lp.green}% Green</span>` : ""}
      ${lp.amber ? `<span style="${pillStyle("#fffbeb", "#92400e")}">${lp.amber}% Amber</span>` : ""}
      ${lp.red   ? `<span style="${pillStyle("#fef2f2", "#991b1b")}">${lp.red}% Red</span>` : ""}
    </div>
    <div style="font-size:10.5px;color:#4c1d95;line-height:1.6;">
      In ${nonRedPct}% of simulated weather scenarios, yield exceeds the Q25 threshold (${Math.round(mc.hist_q25).toLocaleString()} Kg/ha).
      P10–P90 range: ${Math.round(mc.p10).toLocaleString()}–${Math.round(mc.p90).toLocaleString()} Kg/ha.
    </div>
    <div style="font-size:9.5px;color:#7c3aed;margin-top:6px;">
      Weather inputs sampled from N(current, (0.3&middot;&sigma;)&sup2;). Non-weather inputs held constant. This quantifies input uncertainty, complementing the model uncertainty interval (&plusmn;${ciHalf.toFixed(0)} Kg/ha &mdash; ${ciLabel}).
    </div>
  </div>`;
      })()
    : ""}

  <!-- 3-YEAR PLANNING HORIZON -->
  ${advisory._multiYearData && advisory._multiYearData.length === 3
    ? (() => {
        const years = advisory._multiYearData;
        const msp = MSP_PER_QUINTAL[advisory.crop];
        const pct = ((years[2].yld - years[0].yld) / years[0].yld) * 100;
        const traj = pct > 5
          ? { label: "Improving", color: "#065f46", bg: "#ecfdf5", border: "#6ee7b7" }
          : pct < -5
          ? { label: "Declining",  color: "#991b1b", bg: "#fef2f2", border: "#fca5a5" }
          : { label: "Stable",    color: "#92400e", bg: "#fffbeb", border: "#fcd34d" };
        const lvlColor = { green: "#065f46", amber: "#92400e", red: "#991b1b" };
        const lvlBg    = { green: "#ecfdf5", amber: "#fffbeb", red: "#fef2f2" };
        const rows = years.map(y => {
          const diff = y.yld - advisory.hist_median;
          const rev  = msp ? Math.round((y.yld / 100) * msp) : null;
          return `<tr style="border-top:1px solid #e2e8f0;">
            <td style="padding:7px 10px;font-size:11px;font-weight:600;color:#374151;">
              ${y.label}${y.isBase ? ' <span style="font-size:9px;background:#e2e8f0;color:#64748b;padding:1px 6px;border-radius:8px;">base</span>' : ""}
            </td>
            <td style="padding:7px 10px;font-size:11px;font-weight:700;color:#1e293b;text-align:right;">${y.yld.toLocaleString()}</td>
            <td style="padding:7px 10px;text-align:center;">
              <span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;background:${lvlBg[y.level]||"#f1f5f9"};color:${lvlColor[y.level]||"#475569"};">${y.level.toUpperCase()}</span>
            </td>
            <td style="padding:7px 10px;font-size:11px;font-weight:600;color:${diff >= 0 ? "#059669" : "#dc2626"};text-align:right;">${(diff >= 0 ? "+" : "") + diff.toLocaleString()}</td>
            ${msp ? `<td style="padding:7px 10px;font-size:11px;color:#475569;text-align:right;">${rev ? fmtRupee(rev) : "—"}</td>` : ""}
          </tr>`;
        }).join("");
        const decliningNote = traj.label === "Declining"
          ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 12px;margin-top:8px;font-size:10px;color:#9a3412;">
              <strong>Break this cycle:</strong> The Upgrade Path section below shows the minimum irrigation and NPK increase to lift Year 1 yield &mdash; directly reducing downward momentum in Years 2 and 3.
             </div>`
          : "";
        return `
  <div style="background:#f8fafc;border:1.5px solid #c7d2fe;border-radius:12px;padding:12px 16px;margin-bottom:12px;">
    <div style="font-size:10px;font-weight:800;color:#3730a3;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:4px;">&#128197; 3-Year Planning Horizon</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;">Chained yield projections &mdash; prior year yield feeds into next season lag input. Farming inputs held constant.</div>
    <div style="display:inline-block;font-size:10px;font-weight:700;padding:3px 10px;border-radius:12px;background:${traj.bg};color:${traj.color};border:1px solid ${traj.border};margin-bottom:10px;">${traj.label} trajectory (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% over 3 seasons)</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-family:system-ui,sans-serif;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:6px 10px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:left;">Year</th>
          <th style="padding:6px 10px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right;">Yield (Kg/ha)</th>
          <th style="padding:6px 10px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;">Level</th>
          <th style="padding:6px 10px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right;">vs Median</th>
          ${msp ? `<th style="padding:6px 10px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right;">Revenue/ha</th>` : ""}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${decliningNote}
    <div style="font-size:9.5px;color:#94a3b8;margin-top:8px;">Model-based trajectory &mdash; not a forecast. Expand the 3-Year Planning Horizon panel in CropAdvisor for interactive detail.</div>
  </div>`;
      })()
    : ""}

  <!-- UPGRADE PATH -->
  ${advisory._optimizeData && !advisory._optimizeData.already_green
    ? (() => {
        const od  = advisory._optimizeData;
        const feasible   = (od.optimizations || []).filter(o => o.feasible);
        const infeasible = (od.optimizations || []).filter(o => !o.feasible);
        const cp         = od.combined_path;
        const bothInfeasible = feasible.length === 0 && infeasible.length > 0;

        const feasibleRows = feasible.map(o => `
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 12px;margin-bottom:6px;">
            <div style="font-size:10px;font-weight:700;color:#166534;margin-bottom:3px;">${o.label} — Feasible path</div>
            <div style="font-size:11px;color:#166534;">
              ${o.current} \u2192 <strong>${o.recommended}</strong> ${o.unit}
              &nbsp;&nbsp;|&nbsp;&nbsp; +${Math.round(o.yield_gain).toLocaleString()} Kg/ha yield gain
              &nbsp;&nbsp;|&nbsp;&nbsp; New yield: ${Math.round(o.new_yield).toLocaleString()} Kg/ha
            </div>
          </div>`).join("");

        const infeasibleRows = infeasible.map(o => `
          <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;margin-bottom:6px;">
            <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:3px;">${o.label} — Not sufficient alone</div>
            <div style="font-size:10px;color:#64748b;">${o.reason || "Maximum input cannot close the gap independently."}</div>
          </div>`).join("");

        const combinedBlock = cp ? `
          <div style="background:${bothInfeasible ? "#eff6ff" : "#eef2ff"};border:1.5px solid ${bothInfeasible ? "#93c5fd" : "#a5b4fc"};border-radius:8px;padding:10px 12px;margin-top:6px;">
            <div style="font-size:10px;font-weight:800;color:${bothInfeasible ? "#1e40af" : "#3730a3"};margin-bottom:4px;">
              ${bothInfeasible ? "\uD83D\uDEA8 Rescue Path — Joint Intervention" : "\u2728 Alternative — Combined Path"}
            </div>
            <div style="font-size:11px;color:${bothInfeasible ? "#1e40af" : "#3730a3"};line-height:1.7;">
              Irrigation: ${cp.irr_current} \u2192 <strong>${cp.irr_recommended.toFixed(3)}</strong>
              (+${(cp.irr_change_pct).toFixed(1)}%)
              &nbsp;&nbsp;+&nbsp;&nbsp;
              NPK: ${cp.npk_current} \u2192 <strong>${cp.npk_recommended.toFixed(1)}</strong> Kg/ha
              (+${(cp.npk_change_pct).toFixed(1)}%)
            </div>
            <div style="font-size:11px;color:${bothInfeasible ? "#1e3a8a" : "#312e81"};margin-top:4px;font-weight:700;">
              Result: ${Math.round(cp.new_yield).toLocaleString()} Kg/ha &nbsp;(+${Math.round(cp.yield_gain).toLocaleString()} Kg/ha gain)
            </div>
            <div style="font-size:9.5px;color:#64748b;margin-top:5px;">
              ${bothInfeasible
                ? "Neither input alone can reach the district median &mdash; this joint path is the minimum-effort combination that achieves the target. Demonstrates non-linear input complementarity in the XGBoost model."
                : "A combined increase in both inputs achieves the target with smaller individual changes than either path alone."}
            </div>
          </div>` : "";

        return `
  <div style="background:#fafafa;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin-bottom:12px;">
    <div style="font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px;">
      \u2B06 Upgrade Path to Green &mdash; Minimum Intervention
    </div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;">
      Gap to district median: <strong>${Math.round(od.gap || 0).toLocaleString()} Kg/ha</strong>
      &nbsp;&nbsp;|&nbsp;&nbsp; Target: ${Math.round(od.target_yield || 0).toLocaleString()} Kg/ha
    </div>
    ${feasibleRows}
    ${infeasibleRows}
    ${combinedBlock}
  </div>`;
      })()
    : ""}

  <!-- SHAP IMPORTANCE -->
  ${shapRows
    ? `<div style="margin-bottom:18px;">
        <div style="font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px;">Top Yield Factors &mdash; SHAP Importance</div>
        ${shapRows}
        <div style="font-size:10px;color:#94a3b8;margin-top:6px;">Average SHAP importance across 2006&ndash;2015 test set. Higher value = stronger influence on yield prediction.</div>
      </div>`
    : ""}

  <!-- MODEL STABILITY — BACKTEST ADF -->
  ${advisory.backtest_adf
    ? (() => {
        const adf      = advisory.backtest_adf;
        const stColor  = adf.is_stationary ? "#065f46" : "#991b1b";
        const stBg     = adf.is_stationary ? "#ecfdf5" : "#fef2f2";
        const stBorder = adf.is_stationary ? "#a7f3d0" : "#fca5a5";
        const stLabel  = adf.is_stationary ? "Stationary \u2713" : "Non-stationary \u2717";
        const cv1      = adf.critical_values?.["1%"];
        return `
  <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:12px;padding:10px 16px;margin-bottom:12px;">
    <div style="font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">&#128202; Model Stability &mdash; Backtest ADF Stationarity Test</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
      <div style="background:white;border-radius:6px;padding:6px 10px;border:1px solid #e2e8f0;text-align:center;">
        <div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">ADF Statistic</div>
        <div style="font-size:14px;font-weight:800;color:#1e293b;">${adf.adf_stat}</div>
      </div>
      <div style="background:white;border-radius:6px;padding:6px 10px;border:1px solid #e2e8f0;text-align:center;">
        <div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">p-value</div>
        <div style="font-size:14px;font-weight:800;color:#1e293b;">${adf.p_value}</div>
      </div>
      <div style="background:${stBg};border-radius:6px;padding:6px 10px;border:1px solid ${stBorder};text-align:center;">
        <div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">Verdict</div>
        <div style="font-size:11px;font-weight:800;color:${stColor};">${stLabel}</div>
      </div>
    </div>
    <div style="font-size:10px;color:#64748b;line-height:1.6;">${adf.interpretation}. Test applied to ${adf.n_calibration.toLocaleString()} signed residuals from the 2006&ndash;2015 holdout set. Critical value (1%): ${cv1 ?? 'n/a'}.</div>
  </div>`;
      })()
    : ""}

  <!-- HARVEST OUTCOME (only when actual yield has been reported) -->
  ${advisory.actual_yield != null && advisory.actual_level
    ? (() => {
        const errPct    = ((advisory.actual_yield - advisory.predicted_yield) / advisory.predicted_yield * 100).toFixed(1);
        const errSign   = parseFloat(errPct) >= 0 ? "+" : "";
        const errColor  = parseFloat(errPct) >= 0 ? "#059669" : "#dc2626";
        const lvlColor  = { green: "#059669", amber: "#d97706", red: "#dc2626" };
        const lvlBg     = { green: "#ecfdf5", amber: "#fffbeb", red: "#fef2f2" };
        const isCorrect = advisory.level === advisory.actual_level;
        const verdictBg = isCorrect ? "#ecfdf5" : "#fef2f2";
        const verdictBorder = isCorrect ? "#a7f3d0" : "#fca5a5";
        const verdictColor  = isCorrect ? "#065f46" : "#991b1b";
        const verdictIcon   = isCorrect ? "✓" : "✗";
        const verdictLabel  = isCorrect
          ? `Correct classification &mdash; ${advisory.level} advisory confirmed`
          : `Misclassified &mdash; ${advisory.level} advisory, actual outcome was ${advisory.actual_level}`;
        return `
  <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:12px;padding:14px 18px;margin-bottom:16px;">
    <div style="font-size:10px;font-weight:800;color:#0c4a6e;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">&#9875; Harvest Outcome &mdash; Reported by User</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
      <div style="background:white;border-radius:8px;padding:10px 12px;text-align:center;border:1px solid #e0f2fe;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">Predicted yield</div>
        <div style="font-size:17px;font-weight:800;color:#1e293b;">${advisory.predicted_yield.toLocaleString()}</div>
        <div style="font-size:10px;color:#94a3b8;">Kg/ha</div>
      </div>
      <div style="background:white;border-radius:8px;padding:10px 12px;text-align:center;border:1px solid #e0f2fe;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">Actual yield</div>
        <div style="font-size:17px;font-weight:800;color:#1e293b;">${advisory.actual_yield.toLocaleString()}</div>
        <div style="font-size:10px;color:#94a3b8;">Kg/ha</div>
      </div>
      <div style="background:white;border-radius:8px;padding:10px 12px;text-align:center;border:1px solid #e0f2fe;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">Model error</div>
        <div style="font-size:17px;font-weight:800;color:${errColor};">${errSign}${errPct}%</div>
        <div style="font-size:10px;color:#94a3b8;">actual vs predicted</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:11px;">
      <span style="background:${lvlBg[advisory.level]};color:${lvlColor[advisory.level]};font-weight:700;padding:2px 8px;border-radius:12px;text-transform:uppercase;font-size:10px;">${advisory.level}</span>
      <span style="color:#94a3b8;">&#8594;</span>
      <span style="color:#64748b;">Actual:</span>
      <span style="background:${lvlBg[advisory.actual_level]};color:${lvlColor[advisory.actual_level]};font-weight:700;padding:2px 8px;border-radius:12px;text-transform:uppercase;font-size:10px;">${advisory.actual_level}</span>
    </div>
    <div style="background:${verdictBg};border:1.5px solid ${verdictBorder};border-radius:8px;padding:9px 12px;font-size:11px;color:${verdictColor};font-weight:600;">
      ${verdictIcon} ${verdictLabel}
      ${!isCorrect ? `<div style="font-size:10px;font-weight:400;margin-top:4px;opacity:0.85;">Consistent with documented optimistic bias — model trained on 1966–2005 climate norms. See Admin confusion matrix for aggregate pattern.</div>` : ""}
    </div>
  </div>`;
      })()
    : ""}

  <!-- FOOTER -->
  <div style="border-top:1.5px solid #e2e8f0;padding-top:14px;margin-top:4px;">
    <div style="font-size:9.5px;color:#94a3b8;line-height:1.7;">
      <strong style="color:#64748b;">Disclaimer:</strong> Generated by CropAdvisor using XGBoost trained on ICRISAT district-level data (1966&ndash;2005, 311 districts).
      Predictions are probabilistic estimates based on historical agronomic patterns. This report is decision support only, not a guarantee of yield outcomes.
      Actual yields depend on localised soil conditions, micro-climate variability, pest pressure, and agronomic practices not captured at district-level resolution.
      Model R&sup2; for ${cropLabel}: ${(r2 * 100).toFixed(1)}%. Training cutoff: 2005. Post-2015 climate and policy changes are not reflected in model weights.
      ${advisory._climateFromWeather
        ? `<br/><strong style="color:#64748b;">&#8224; Climate inputs</strong> (annual rainfall, Kharif max temp, Rabi min temp) sourced from Open-Meteo historical archive (past 12 months) at advisory generation time.`
        : ""}
    </div>
  </div>

</div>`;
}

export async function generateAdvisoryPDF(advisory, onStart, onDone) {
  if (onStart) onStart();

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;z-index:-999;pointer-events:none;";
  container.innerHTML = buildReportHTML(advisory);
  document.body.appendChild(container);

  try {
    const content = container.firstElementChild;

    // Measure each direct child's position so we can avoid splitting them
    const children = Array.from(content.children);
    const sectionBounds = children.map(el => ({
      top: el.offsetTop,
      bottom: el.offsetTop + el.offsetHeight,
    }));

    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const pdf       = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW     = pdf.internal.pageSize.getWidth();
    const pageH     = pdf.internal.pageSize.getHeight();
    const margin    = 8;
    const usableW   = pageW - margin * 2;
    const usableH   = pageH - margin * 2;
    const htmlWidth = content.offsetWidth;
    const scale     = usableW / htmlWidth;
    const pagePx    = usableH / scale;
    const cScale    = 2; // html2canvas scale factor

    // Compute page break points aligned to section boundaries
    const breaks = [0];
    let pageBottom = pagePx;

    for (const b of sectionBounds) {
      if (b.bottom > pageBottom + 2) {
        // This child overflows — break before it
        breaks.push(b.top);
        pageBottom = b.top + pagePx;
      }
    }

    const totalH = content.offsetHeight;

    for (let i = 0; i < breaks.length; i++) {
      if (i > 0) pdf.addPage();

      const startPx = breaks[i];
      const endPx   = i + 1 < breaks.length ? breaks[i + 1] : totalH;
      const sliceH  = endPx - startPx;

      const pageCanvas  = document.createElement("canvas");
      pageCanvas.width  = canvas.width;
      pageCanvas.height = Math.ceil(sliceH * cScale);
      const ctx = pageCanvas.getContext("2d");
      ctx.drawImage(
        canvas,
        0, Math.floor(startPx * cScale),            // source x, y
        canvas.width, Math.ceil(sliceH * cScale),    // source w, h
        0, 0,                                         // dest x, y
        canvas.width, Math.ceil(sliceH * cScale)     // dest w, h
      );

      const imgData = pageCanvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", margin, margin, usableW, sliceH * scale);
    }

    const crop = advisory.crop.replace(/_/g, "-");
    const dist = advisory.district_name
      ? `_${advisory.district_name.replace(/\s+/g, "-")}`
      : "";
    const date = new Date().toISOString().split("T")[0];
    pdf.save(`CropAdvisor_${crop}${dist}_${date}.pdf`);
  } finally {
    document.body.removeChild(container);
    if (onDone) onDone();
  }
}



function buildAdminReportHTML({ recs, driftData }) {
  const ALL_CROPS = [
    "rice","wheat","maize","sorghum","pearl_millet",
    "chickpea","pigeonpea","groundnut","cotton","sugarcane",
  ];
  const RETRAIN_THRESHOLD = 5;

  const total       = recs.length;
  const uniqueUsers = new Set(recs.map(r => r.user_id)).size;
  const accepted    = recs.filter(r => r.status === "accepted").length;
  const acceptRate  = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const lc = { red: 0, amber: 0, green: 0 };
  recs.forEach(r => { if (r.level in lc) lc[r.level]++; });
  const pct = l => total > 0 ? Math.round((lc[l] / total) * 100) : 0;

  const reports  = driftData?.reports || [];
  const withErr  = reports.filter(r => r.abs_error != null);
  const nReports = withErr.length;
  const mae = nReports > 0
    ? Math.round(withErr.reduce((s, r) => s + r.abs_error, 0) / nReports)
    : null;
  const bias = nReports > 0
    ? (withErr.reduce((s, r) => s + r.error_pct, 0) / nReports).toFixed(1)
    : null;
  const shocks = withErr.filter(r => r.is_shock).length;

  const LEVELS = ["red", "amber", "green"];
  const cls    = reports.filter(r => r.advisory_level && r.actual_level);
  const mx = {};
  LEVELS.forEach(p => { mx[p] = {}; LEVELS.forEach(a => { mx[p][a] = 0; }); });
  cls.forEach(r => {
    if (mx[r.advisory_level]?.[r.actual_level] !== undefined)
      mx[r.advisory_level][r.actual_level]++;
  });
  const correct   = LEVELS.reduce((s, l) => s + mx[l][l], 0);
  const acc       = cls.length > 0 ? Math.round((correct / cls.length) * 100) : null;
  const redTotal  = LEVELS.reduce((s, a) => s + mx.red[a], 0);
  const zeroRed   = cls.length > 0 && redTotal === 0
    && (mx.green?.red || 0) + (mx.amber?.red || 0) > 0;
  const redMisses = (mx.green?.red || 0) + (mx.amber?.red || 0);

  const cusum   = driftData?.cusum   || {};
  const adf     = driftData?.adf     || {};
  const summary = driftData?.summary || {};

  const cusumEntries = Object.entries(cusum).filter(([, d]) => d.n_errors >= 2);
  const adfEntries   = Object.entries(adf).filter(([, d]) => d && d.p_value !== null);

  const cropRows = ALL_CROPS.map(crop => {
    const count = summary[crop]?.count || 0;
    const drift = cusum[crop]?.drift_detected === true;
    const status = drift && count >= RETRAIN_THRESHOLD ? "drift"
                 : count >= RETRAIN_THRESHOLD          ? "ready" : "insufficient";
    return { crop, count, status };
  });

  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const sc = (v, label, color = "#1e293b") =>
    `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:${color};">${v}</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px;">${label}</div>
    </div>`;

  const lvlBlock = (lvl, label, bg, bd, col) =>
    `<div style="background:${bg};border:1px solid ${bd};border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:16px;font-weight:700;color:${col};">${lc[lvl]}</div>
        <div style="font-size:10px;font-weight:600;color:${col};margin-top:2px;">${label}</div>
      </div>
      <div style="font-size:18px;font-weight:800;opacity:0.3;color:${col};">${pct(lvl)}%</div>
    </div>`;

  const cusumRowsHTML = cusumEntries.length > 0
    ? cusumEntries.map(([crop, d]) =>
        `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:6px 10px;font-size:11px;font-weight:500;text-transform:capitalize;">${crop.replace(/_/g, " ")}</td>
          <td style="padding:6px 10px;font-size:11px;text-align:center;color:#64748b;">${d.n_errors}</td>
          <td style="padding:6px 10px;text-align:center;">
            ${d.drift_detected
              ? `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;">DRIFT &mdash; ${d.drift_direction}</span>`
              : `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;">Within control limits</span>`}
          </td>
          <td style="padding:6px 10px;font-size:10px;color:#94a3b8;text-align:center;">&sigma; = ${d.sigma} &middot; h = ${d.threshold}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="padding:10px;text-align:center;color:#94a3b8;font-size:11px;">No crops with sufficient data (min 2 reports)</td></tr>`;

  const adfRowsHTML = adfEntries.length > 0
    ? [...adfEntries]
        .sort(([, a], [, b]) =>
          a.is_stationary === b.is_stationary ? 0 : a.is_stationary ? 1 : -1)
        .map(([crop, d]) =>
          `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:6px 10px;font-size:11px;font-weight:500;text-transform:capitalize;">${crop.replace(/_/g, " ")}</td>
            <td style="padding:6px 10px;text-align:center;">
              ${d.is_stationary
                ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;">Stationary</span>`
                : `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;">Non-stationary</span>`}
            </td>
            <td style="padding:6px 10px;font-size:11px;font-family:monospace;text-align:center;font-weight:700;color:${d.p_value < 0.05 ? "#15803d" : "#b91c1c"};">${d.p_value.toFixed(4)}</td>
            <td style="padding:6px 10px;font-size:10px;font-family:monospace;color:#94a3b8;text-align:center;">${d.adf_stat}</td>
            <td style="padding:6px 10px;font-size:10px;text-align:center;color:#64748b;">${d.n_errors}</td>
          </tr>`).join("")
    : `<tr><td colspan="5" style="padding:10px;text-align:center;color:#94a3b8;font-size:11px;">No crops with sufficient data (min 5 reports)</td></tr>`;

  const precRowsHTML = cls.length > 0
    ? LEVELS.map(p => {
        const rt   = LEVELS.reduce((s, a) => s + mx[p][a], 0);
        const prec = rt > 0 ? Math.round((mx[p][p] / rt) * 100) : null;
        const cc   = { green: "#059669", amber: "#d97706", red: "#dc2626" };
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
          <span style="font-size:10px;font-weight:700;text-transform:capitalize;width:44px;color:${cc[p]};">${p}</span>
          <span style="font-size:10px;color:#64748b;">${mx[p][p]} / ${rt} correct</span>
          <span style="margin-left:auto;font-size:11px;font-weight:700;color:${
            prec != null
              ? prec >= 70 ? "#059669" : prec >= 40 ? "#d97706" : "#dc2626"
              : "#94a3b8"
          };">${prec != null ? prec + "%" : "&mdash;"}</span>
        </div>`;
      }).join("")
    : "";

  const chipHTML = cropRows.map(({ crop, count, status }) => {
    const bg  = status === "drift" ? "#fee2e2" : status === "ready" ? "#fef9c3" : "#f1f5f9";
    const col = status === "drift" ? "#b91c1c" : status === "ready" ? "#854d0e"  : "#94a3b8";
    const lbl = status === "drift" ? "Drift"   : status === "ready" ? "Ready"    : `${count}/${RETRAIN_THRESHOLD}`;
    return `<div style="background:${bg};border-radius:20px;padding:3px 10px;display:inline-flex;align-items:center;gap:5px;margin:3px;">
      <span style="font-size:10px;font-weight:500;text-transform:capitalize;color:#374151;">${crop.replace(/_/g, " ")}</span>
      <span style="font-size:9px;font-weight:700;color:${col};">${lbl}</span>
    </div>`;
  }).join("");

  return `<div id="admin-pdf-root" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px;width:800px;color:#1e293b;background:#ffffff;box-sizing:border-box;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;margin-bottom:20px;border-bottom:2px solid #6366f1;">
    <div>
      <div style="font-size:20px;font-weight:800;color:#1e293b;">CropAdvisor</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;font-weight:500;">Admin Analytics Report</div>
    </div>
    <div style="text-align:right;">
      <div style="display:inline-block;background:#eef2ff;color:#4338ca;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;">ADMIN ONLY</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:5px;">Generated ${date}</div>
    </div>
  </div>
  <div style="margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:8px;">Platform Summary</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
      ${sc(total.toLocaleString(), "Total Predictions")}
      ${sc(uniqueUsers, "Unique Users")}
      ${sc(acceptRate + "%", "Acceptance Rate", acceptRate >= 50 ? "#059669" : "#d97706")}
      ${sc(nReports, "Yield Reports Filed", nReports > 0 ? "#2563eb" : "#94a3b8")}
    </div>
  </div>
  <div style="margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:8px;">Advisory Level Distribution</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
      ${lvlBlock("green", "Green &mdash; Good outlook",   "#f0fdf4", "#86efac", "#15803d")}
      ${lvlBlock("amber", "Amber &mdash; Below average", "#fffbeb", "#fcd34d", "#b45309")}
      ${lvlBlock("red",   "Red &mdash; Poor outlook",    "#fef2f2", "#fca5a5", "#b91c1c")}
    </div>
  </div>
  ${cls.length > 0 ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:8px;">Model Classification Accuracy</div>
    <div style="display:flex;gap:8px;">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;text-align:center;min-width:90px;">
        <div style="font-size:26px;font-weight:800;color:${acc >= 70 ? "#059669" : acc >= 40 ? "#d97706" : "#dc2626"};">${acc}%</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px;">Overall accuracy</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:1px;">${cls.length} harvest reports</div>
      </div>
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
        <div style="font-size:10px;font-weight:600;color:#64748b;margin-bottom:8px;">Precision per advisory level</div>
        ${precRowsHTML}
      </div>
    </div>
    ${zeroRed ? `<div style="margin-top:8px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;">
      <span style="font-size:11px;color:#92400e;">&#x26A0; Optimistic bias: 0 Red advisories issued vs ${redMisses} actual Red outcome${redMisses !== 1 ? "s" : ""}. Documented pre-2005 training limitation.</span>
    </div>` : ""}
  </div>` : ""}
  ${mae !== null ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:8px;">Prediction Error Summary</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
      ${sc(mae.toLocaleString() + " Kg/ha", "Mean Absolute Error")}
      ${sc((parseFloat(bias) >= 0 ? "+" : "") + bias + "%", "Average Bias", parseFloat(bias) < 0 ? "#d97706" : "#2563eb")}
      ${sc(shocks, "Yield Shock Events (&gt;35%)", shocks > 0 ? "#dc2626" : "#94a3b8")}
    </div>
  </div>` : ""}
  <div style="margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:8px;">CUSUM Sequential Drift Detection</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="background:#f1f5f9;">
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Crop</th>
        <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Reports</th>
        <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Status</th>
        <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Parameters</th>
      </tr></thead>
      <tbody>${cusumRowsHTML}</tbody>
    </table>
  </div>
  ${adfEntries.length > 0 ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:8px;">ADF Stationarity Test &mdash; Unit Root Detection</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="background:#f1f5f9;">
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Crop</th>
        <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Verdict</th>
        <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">p-value</th>
        <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">ADF stat</th>
        <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">n</th>
      </tr></thead>
      <tbody>${adfRowsHTML}</tbody>
    </table>
  </div>` : ""}
  <div style="margin-bottom:24px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:8px;">Retraining Readiness (&ge;${RETRAIN_THRESHOLD} reports per crop)</div>
    <div style="display:flex;flex-wrap:wrap;">${chipHTML}</div>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding-top:12px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:9px;color:#94a3b8;">CropAdvisor &middot; XGBoost &middot; ICRISAT 1966&ndash;2005 &middot; Test set 2006&ndash;2015</span>
    <span style="font-size:9px;color:#94a3b8;">Admin report &mdash; not for distribution</span>
  </div>
</div>`;
}

export async function generateAdminPDF({ recs, driftData }, onStart, onDone) {
  onStart?.();
  try {
    const html    = buildAdminReportHTML({ recs, driftData });
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:860px;z-index:-1;";
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    await new Promise(res => setTimeout(res, 150));
    const { default: Html2Canvas } = await import("html2canvas");
    const { default: JsPDF }       = await import("jspdf");
    const root   = wrapper.querySelector("#admin-pdf-root");
    const canvas = await Html2Canvas(root, {
      scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
    });
    const pdf     = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const margin  = 12;
    const usableW = pdf.internal.pageSize.getWidth()  - margin * 2;
    const usableH = pdf.internal.pageSize.getHeight() - margin * 2;
    const mmPerPx = usableW / canvas.width;
    const totalH  = canvas.height * mmPerPx;
    let yMm = 0, page = 0;
    while (yMm < totalH) {
      if (page > 0) pdf.addPage();
      const srcY     = Math.round(yMm / mmPerPx);
      const sliceH   = Math.min(usableH, totalH - yMm);
      const slicePx  = Math.round(sliceH / mmPerPx);
      const actualPx = Math.min(slicePx, canvas.height - srcY);
      const slice    = document.createElement("canvas");
      slice.width  = canvas.width;
      slice.height = actualPx;
      slice.getContext("2d").drawImage(
        canvas, 0, srcY, canvas.width, actualPx, 0, 0, canvas.width, actualPx
      );
      pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, usableW, actualPx * mmPerPx);
      yMm += usableH;
      page++;
    }
    pdf.save(`cropAdvisor_admin_${new Date().toISOString().slice(0, 10)}.pdf`);
    document.body.removeChild(wrapper);
  } catch (err) {
    console.error("Admin PDF generation failed:", err);
  } finally {
    onDone?.();
  }
}
