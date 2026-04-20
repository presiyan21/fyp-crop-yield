import json
import pytest
from services.model_service import (
    predict,
    generate_advisory,
    rank_all_crops,
    compute_cusum,
    compute_adf_stationarity,
    sensitivity_analysis,
    optimize_inputs,
)

pytestmark = pytest.mark.integration


# Service-layer integration: combinations of functions that must agree internally.
def test_predict_matches_advisory_predicted_yield(rice_features):
    """predict() and generate_advisory() must agree to within 1dp rounding."""
    raw = predict("rice", rice_features)
    advisory = generate_advisory("rice", rice_features)
    assert abs(round(raw, 1) - advisory["predicted_yield"]) < 0.1


def test_rank_all_crops_agrees_with_individual_predict(rice_features):
    """rank_all_crops must include a rice entry whose predicted yield matches a direct predict() call."""
    from services.model_service import _feature_cols
    row = {col: 0.0 for col in _feature_cols["rice"]}
    for k, v in rice_features.items():
        if k in row:
            row[k] = v

    direct = predict("rice", row)
    ranked = rank_all_crops(row)
    rice_entry = next(r for r in ranked if r["crop"] == "rice")
    assert abs(rice_entry["predicted_yield"] - round(direct, 1)) < 1.0


def test_advisory_level_consistent_with_quartiles(rice_features):
    """Level and quartiles in the response must be mutually consistent."""
    advisory = generate_advisory("rice", rice_features)
    pred = advisory["predicted_yield"]
    q25 = advisory["hist_q25"]
    med = advisory["hist_median"]

    if pred < q25:
        assert advisory["level"] == "red"
    elif pred < med:
        assert advisory["level"] == "amber"
    else:
        assert advisory["level"] == "green"


def test_sensitivity_base_yield_matches_advisory(rice_features):
    """sensitivity_analysis.base_yield must match a direct predict() call."""
    sens = sensitivity_analysis("rice", rice_features)
    direct = predict("rice", rice_features)
    assert abs(sens["base_yield"] - round(direct, 1)) < 0.1


def test_cusum_and_adf_agree_on_stable_series(small_errors):
    """Small balanced series: CUSUM should not alarm and ADF should not contradict it."""
    cusum = compute_cusum(small_errors)
    adf = compute_adf_stationarity(small_errors)
    assert cusum["drift_detected"] is False
    # ADF is underpowered at n=8 — only check it doesn't contradict CUSUM
    if adf["is_stationary"] is not None:
        assert adf["is_stationary"] is True or adf["p_value"] > 0.05


def test_optimize_respects_already_green_early_exit(rice_features):
    """already_green short-circuit: base prediction >= hist_median skips optimisation."""
    result = optimize_inputs("rice", rice_features)
    if result["already_green"]:
        assert result["optimizations"] == []
        assert result["base_yield"] >= result["target_yield"]
    else:
        assert "gap" in result
        assert result["gap"] > 0


# Route → service integration: HTTP through Flask, routing, service, and back.
def test_predict_route_returns_same_value_as_service(client, rice_features):
    """HTTP round-trip must match direct service call to 1dp."""
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200
    api_value = json.loads(resp.data)["predicted_yield"]
    service_value = round(predict("rice", rice_features), 1)
    assert abs(api_value - service_value) < 0.1


def test_health_endpoint_reflects_config(client):
    """Health endpoint: route → config integration."""
    resp = client.get("/api/health")
    body = json.loads(resp.data)
    assert body["status"] == "ok"
    assert body["crops_loaded"] == 10


def test_app_registers_all_seven_blueprints(client):
    """Integration of create_app() with the seven route modules."""
    app = client.application
    expected = {"predict", "recommend", "crops", "health",
                "history", "settings", "yield_reports"}
    assert expected.issubset(set(app.blueprints.keys()))


def test_content_type_json_required_for_predict(client, rice_features):
    """Missing Content-Type header causes get_json() to return None — route rejects as missing data."""
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "rice", "features": rice_features}))
    assert resp.status_code in (400, 415, 500)