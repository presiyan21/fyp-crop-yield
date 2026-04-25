import axios from "axios";
import { supabase } from "./supabase";

const api = axios.create({ baseURL: "/api" });

// Automatically attach the Supabase JWT on every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

export const fetchCrops      = ()           => api.get("/crops").then(r => r.data.crops);
export const fetchCropSchema = (crop)       => api.get(`/crops/${crop}/schema`).then(r => r.data.features);
export const fetchCropDistricts = (crop) => api.get(`/crops/${crop}/districts`).then(r => r.data.districts);
export const fetchDistrictCropSummary = (distCode) => api.get(`/districts/${distCode}/crops`).then(r => r.data.crops);
export const fetchModelInfo  = ()           => api.get("/model-info").then(r => r.data);
export const healthCheck     = ()           => api.get("/health").then(r => r.data);

export const getPrediction      = (crop, features)        => api.post("/predict",    { crop, features }).then(r => r.data);
export const getRecommendation  = (crop, features, distCode) =>
  api.post("/recommend", { crop, features, dist_code: distCode ?? null }).then(r => r.data);

export async function fetchYieldReports() {
  const { data } = await api.get("/yield-reports");
  return data;
}

export async function reportYield(recId, actualYield) {
  const { data } = await api.post(`/recommendations/${recId}/report-yield`, { actual_yield: actualYield });
  return data;
}

export const acceptRecommendation = (id) => api.patch(`/recommendations/${id}/accept`).then(r => r.data);

export const fetchHistory = () => api.get("/history").then(r => r.data);
export const deleteRecommendation = (id) => api.delete(`/history/${id}`).then(r => r.data);

export const fetchSettings  = ()             => api.get("/settings").then(r => r.data);
export const updateSettings = (thresholds)   => api.put("/settings", thresholds).then(r => r.data);
export const resetSettings  = ()             => api.delete("/settings").then(r => r.data);
export const rankCrops = (features, distCode) =>
  api.post("/crops/rank", { features, dist_code: distCode ?? null }).then(r => r.data);
export async function fetchBacktest(crop, distCode) {
  const { data } = await api.get(`/crops/${crop}/backtest?dist_code=${distCode}`);
  return data;
}
export const fetchSensitivity = (crop, features, dist_code) =>
  api.post("/sensitivity", { crop, features, dist_code }).then(r => r.data);
export const fetchDistrictWeather = (distCode) =>
  api.get(`/districts/${distCode}/weather`).then(r => r.data).catch(() => null);
export const fetchDistrictWeatherForecast = (distCode) =>
  api.get(`/districts/${distCode}/weather/forecast`).then(r => r.data).catch(() => null);
export const fetchMonteCarlo = (crop, features, dist_code) =>
  api.post("/montecarlo", { crop, features, dist_code }).then(r => r.data);
export const fetchRiskCompare = (features, dist_code) =>
  api.post("/crops/risk-compare", { features, dist_code }).then(r => r.data);
export const fetchSeasonConditions = (crop, features) =>
  api.post("/crops/season-conditions", { crop, features }).then(r => r.data);
export const fetchOptimizeInputs = (crop, features, dist_code) =>
  api.post("/optimize-inputs", { crop, features, dist_code }).then(r => r.data);
