// Feature label map — used by AdvisoryCard (SHAP), Models page, Dashboard hints.

const FEATURE_LABELS = {
  YIELD_LAG_1:        { label: "Previous year's yield",       unit: "Kg/ha", category: "Yield History",   userField: true },
  YIELD_LAG_3:        { label: "3-year lagged yield",         unit: "Kg/ha", category: "Yield History",   userField: false },

  IRRIGATION_RATIO:   { label: "Irrigation coverage",         unit: "ratio", category: "Water & Irrigation", userField: true },
  "ANNUAL RAINFALL (Millimeters)": { label: "Annual rainfall", unit: "mm",  category: "Water & Irrigation", userField: true },
  RAINFALL_DEV_PCT:   { label: "Rainfall deviation from normal", unit: "%", category: "Water & Irrigation", userField: false },
  RAINFALL_DEV_MM:    { label: "Rainfall deviation (absolute)", unit: "mm", category: "Water & Irrigation", userField: false },
  KHARIF_RAIN_MM:     { label: "Monsoon season rainfall",     unit: "mm",    category: "Water & Irrigation", userField: false },
  RABI_RAIN_MM:       { label: "Winter season rainfall",      unit: "mm",    category: "Water & Irrigation", userField: false },
  CANAL_WELL_RATIO:   { label: "Canal-to-well irrigation ratio", unit: "",   category: "Water & Irrigation", userField: false },
  WATER_INTENSITY:    { label: "Water use intensity",          unit: "",      category: "Water & Irrigation", userField: false },
  "CANALS AREA (1000 ha)":      { label: "Canal-irrigated area",   unit: "×1000 ha", category: "Water & Irrigation", userField: false },
  "TUBE WELLS AREA (1000 ha)":  { label: "Tube well area",         unit: "×1000 ha", category: "Water & Irrigation", userField: false },
  "TOTAL WELLS AREA (1000 ha)": { label: "Total well-irrigated area", unit: "×1000 ha", category: "Water & Irrigation", userField: false },

  NPK_TOTAL_KG_PER_HA: { label: "Fertilizer application (NPK)", unit: "Kg/ha", category: "Fertilizer", userField: true },
  N_KG_PER_HA:        { label: "Nitrogen application",        unit: "Kg/ha", category: "Fertilizer",       userField: false },
  P_KG_PER_HA:        { label: "Phosphorus application",      unit: "Kg/ha", category: "Fertilizer",       userField: false },
  K_KG_PER_HA:        { label: "Potassium application",       unit: "Kg/ha", category: "Fertilizer",       userField: false },
  N_SHARE:            { label: "Nitrogen share of total NPK",  unit: "",     category: "Fertilizer",       userField: false },
  FERT_KHARIF_TONS:   { label: "Monsoon fertilizer use",       unit: "tons", category: "Fertilizer",       userField: false },
  FERT_RABI_TONS:     { label: "Winter fertilizer use",        unit: "tons", category: "Fertilizer",       userField: false },
  FERT_IRR_INTERACTION: { label: "Fertilizer × irrigation interaction", unit: "", category: "Fertilizer",  userField: false },
  FERT_DATA_AVAILABLE:  { label: "Fertilizer data availability flag",   unit: "", category: "Fertilizer",  userField: false },

  KHARIF_TMAX:        { label: "Monsoon max temperature",     unit: "°C",    category: "Temperature",      userField: true },
  RABI_TMIN:          { label: "Winter min temperature",      unit: "°C",    category: "Temperature",      userField: true },
  KHARIF_TMIN:        { label: "Monsoon min temperature",     unit: "°C",    category: "Temperature",      userField: false },
  RABI_TMAX:          { label: "Winter max temperature",      unit: "°C",    category: "Temperature",      userField: false },
  ANNUAL_TMAX:        { label: "Annual max temperature",      unit: "°C",    category: "Temperature",      userField: false },
  ANNUAL_TMIN:        { label: "Annual min temperature",      unit: "°C",    category: "Temperature",      userField: false },
  DIURNAL_TEMP_RANGE: { label: "Day-night temperature range", unit: "°C",    category: "Temperature",      userField: false },
  HEAT_STRESS:        { label: "Heat stress index",           unit: "",      category: "Temperature",      userField: false },
  COLD_STRESS:        { label: "Cold stress index",           unit: "",      category: "Temperature",      userField: false },
  KHARIF_TEMP_RANGE:  { label: "Monsoon temperature range",   unit: "°C",    category: "Temperature",      userField: false },
  RABI_TEMP_RANGE:    { label: "Winter temperature range",    unit: "°C",    category: "Temperature",      userField: false },

  "NET AREA (1000 ha)":          { label: "Net sown area",           unit: "×1000 ha", category: "Land Use", userField: false },
  "GROSS AREA (1000 ha)":        { label: "Gross sown area",         unit: "×1000 ha", category: "Land Use", userField: false },
  "NET CROPPED AREA (1000 ha)":  { label: "Net cropped area",        unit: "×1000 ha", category: "Land Use", userField: false },
  "GROSS CROPPED AREA (1000 ha)":{ label: "Gross cropped area",      unit: "×1000 ha", category: "Land Use", userField: false },
  CROPPING_INTENSITY: { label: "Cropping intensity",           unit: "%",     category: "Land Use",         userField: false },
  NET_CROP_RATIO:     { label: "Net-to-gross crop ratio",      unit: "",      category: "Land Use",         userField: false },
  GROWING_PERIOD_DAYS:{ label: "Growing season length",        unit: "days",  category: "Land Use",         userField: false },

  YEAR_TREND:         { label: "Long-term technology trend",   unit: "",      category: "Time",             userField: false },
  DECADE:             { label: "Decade",                       unit: "",      category: "Time",             userField: false },

  PRICE_TREND_3YR:    { label: "3-year price trend",           unit: "₹/Qt",  category: "Economic",         userField: false },
  "ANNUAL NORMAL RAINFALL (Millimeters)": { label: "Normal expected rainfall", unit: "mm", category: "Water & Irrigation", userField: false },

  SOIL_INCEPTISOLS:         { label: "Inceptisol soil",              unit: "", category: "Soil Type", userField: false },
  SOIL_LOAMY:               { label: "Loamy soil",                   unit: "", category: "Soil Type", userField: false },
  SOIL_ORTHIDS:             { label: "Orthid soil",                  unit: "", category: "Soil Type", userField: false },
  SOIL_OTHER:               { label: "Other soil type",              unit: "", category: "Soil Type", userField: false },
  SOIL_PSSAMENTS:           { label: "Psamments (sandy) soil",       unit: "", category: "Soil Type", userField: false },
  SOIL_SANDY:               { label: "Sandy soil",                   unit: "", category: "Soil Type", userField: false },
  SOIL_UDALFS:              { label: "Udalf soil",                   unit: "", category: "Soil Type", userField: false },
  "SOIL_UDOLLS/UDALFS":    { label: "Udoll/Udalf soil",             unit: "", category: "Soil Type", userField: false },
  "SOIL_UDUPTS/UDALFS":    { label: "Udupt/Udalf soil",             unit: "", category: "Soil Type", userField: false },
  "SOIL_USTALF/USTOLLS":   { label: "Ustalf/Ustoll soil",            unit: "", category: "Soil Type", userField: false },
  "SOIL_USTALFS-OCHREPTS": { label: "Ustalf-Ochrept soil",           unit: "", category: "Soil Type", userField: false },
  SOIL_VERTIC:              { label: "Vertic soil",                   unit: "", category: "Soil Type", userField: false },
  SOIL_VERTISOLS:           { label: "Vertisol (black clay) soil",    unit: "", category: "Soil Type", userField: false },
};

export function getFeatureLabel(featureName) {
  // Direct match
  if (FEATURE_LABELS[featureName]) {
    return FEATURE_LABELS[featureName].label;
  }

  // Crop-specific price column: e.g. "RICE STATE_PRICE (Rupees/Quintal)"
  if (featureName.includes("STATE_PRICE")) {
    return "State market price";
  }

  // Crop-specific irrigated area: e.g. "WHEAT IRRIGATED AREA (1000 ha)"
  if (featureName.includes("IRRIGATED AREA")) {
    return "Crop irrigated area";
  }

  // Fallback: clean up underscores and capitalisation
  return featureName
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\(.*?\)/g, "")
    .trim();
}

export function getFeatureMeta(featureName) {
  if (FEATURE_LABELS[featureName]) {
    return FEATURE_LABELS[featureName];
  }

  if (featureName.includes("STATE_PRICE")) {
    return { label: "State market price", unit: "₹/Qt", category: "Economic", userField: false };
  }

  if (featureName.includes("IRRIGATED AREA")) {
    return { label: "Crop irrigated area", unit: "×1000 ha", category: "Water & Irrigation", userField: false };
  }

  return {
    label: getFeatureLabel(featureName),
    unit: "",
    category: "Other",
    userField: false,
  };
}

export function isUserControllable(featureName) {
  return FEATURE_LABELS[featureName]?.userField === true;
}

export function getConfidenceTier(r2) {
  if (r2 >= 0.75) return {
    tier: "high",
    label: "High confidence",
    description: "The model explains most of the variation in yield. Predictions are generally reliable.",
    colour: "emerald",
  };
  if (r2 >= 0.55) return {
    tier: "moderate",
    label: "Moderate confidence",
    description: "The model captures broad trends but may miss some variation. Use alongside local knowledge.",
    colour: "amber",
  };
  return {
    tier: "low",
    label: "Lower confidence",
    description: "Yield for this crop is harder to predict from available data. Treat as a rough guide.",
    colour: "red",
  };
}

export default FEATURE_LABELS;
