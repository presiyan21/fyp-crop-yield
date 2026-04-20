const PLANTING_WINDOWS = {
  rice:         { window: "Jun-Aug",          sowMonths: [5,6,7],   season: "Kharif"  },
  wheat:        { window: "Oct-Nov",          sowMonths: [9,10],    season: "Rabi"    },
  maize:        { window: "Jun-Jul",          sowMonths: [5,6],     season: "Kharif"  },
  sorghum:      { window: "Jun-Jul",          sowMonths: [5,6],     season: "Kharif"  },
  pearl_millet: { window: "Jun-Jul",          sowMonths: [5,6],     season: "Kharif"  },
  chickpea:     { window: "Oct-Nov",          sowMonths: [9,10],    season: "Rabi"    },
  pigeonpea:    { window: "Jun-Jul",          sowMonths: [5,6],     season: "Kharif"  },
  groundnut:    { window: "Jun-Jul",          sowMonths: [5,6],     season: "Kharif"  },
  cotton:       { window: "May-Jun",          sowMonths: [4,5],     season: "Kharif"  },
  sugarcane:    { window: "Feb-Mar / Oct-Nov",sowMonths: [1,2,9,10],season: "Annual"  },
};

export function generateNotifications(recommendations) {
  const notifs = [];
  const now = new Date();
  const currentMonth = now.getMonth();

  // Type 1: Pending harvest report (accepted >= 30 days ago, no yield reported)
  const pending = recommendations.filter(r => {
    if (r.status !== "accepted") return false;
    if (r.actual_yield != null) return false;
    const since = (now - new Date(r.accepted_at || r.created_at)) / 86400000;
    return since >= 30;
  });

  pending.slice(0, 3).forEach(r => {
    const days = Math.round((now - new Date(r.accepted_at || r.created_at)) / 86400000);
    const cropLabel = r.crop.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    notifs.push({
      id: `pending_${r.id}`,
      type: "pending_harvest",
      icon: "chart",
      title: `Harvest report pending - ${cropLabel}`,
      body: `You accepted this ${cropLabel} advisory ${days} days ago but have not yet reported your actual yield.`,
      link: "/history",
      linkLabel: "Report harvest",
      createdAt: r.accepted_at || r.created_at,
    });
  });

  // Type 2: Planting window approaching within 2 months for crops user has used
  const cropsUsed = [...new Set(recommendations.map(r => r.crop))];
  cropsUsed.forEach(cropKey => {
    const w = PLANTING_WINDOWS[cropKey];
    if (!w) return;
    const monthsAway = w.sowMonths
      .map(m => { const d = m - currentMonth; return d > 0 ? d : d + 12; })
      .filter(d => d > 0 && d <= 2);
    if (monthsAway.length === 0) return;
    const minMonths = Math.min(...monthsAway);
    const cropLabel = cropKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    const count = recommendations.filter(r => r.crop === cropKey).length;
    notifs.push({
      id: `planting_${cropKey}_${now.getFullYear()}_${currentMonth}`,
      type: "planting_window",
      icon: "seedling",
      title: `${cropLabel} planting season in ${minMonths} month${minMonths > 1 ? "s" : ""}`,
      body: `${w.season} sowing window (${w.window}) is approaching. You have ${count} past ${count === 1 ? "advisory" : "advisories"} for ${cropLabel}.`,
      link: `/?crop=${cropKey}`,
      linkLabel: "Plan advisory",
      createdAt: now.toISOString(),
    });
  });

  return notifs;
}

export function getReadIds(userId) {
  try {
    const raw = localStorage.getItem(`cropAdvisor_notif_read_${userId}`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function generateDriftNotifications(yieldReportsData) {
  const notifs = [];
  const cusum  = yieldReportsData?.cusum || {};
  Object.entries(cusum).forEach(([cropKey, c]) => {
    if (!c.drift_detected) return;
    const cropLabel = cropKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    const direction = c.drift_direction === "underestimating"
      ? "underestimating yield"
      : "overestimating yield";
    notifs.push({
      id:        `drift_${cropKey}`,
      type:      "drift_alert",
      icon:      "drift",
      title:     `Model drift detected — ${cropLabel}`,
      body:      `CUSUM analysis of ${c.n_errors} harvest report${c.n_errors !== 1 ? "s" : ""} shows the model is systematically ${direction} for ${cropLabel}. Review calibration or trigger a retraining cycle on the Analytics page.`,
      link:      "/admin",
      linkLabel: "View Analytics",
      createdAt: new Date().toISOString(),
    });
  });
  return notifs;
}

export function markAsRead(userId, ids) {
  try {
    const existing = getReadIds(userId);
    ids.forEach(id => existing.add(id));
    localStorage.setItem(
      `cropAdvisor_notif_read_${userId}`,
      JSON.stringify([...existing])
    );
  } catch { /* ignore localStorage errors */ }
}
