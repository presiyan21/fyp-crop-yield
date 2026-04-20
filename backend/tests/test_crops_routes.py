import json
import pytest
from services.model_service import _feature_cols

pytestmark = pytest.mark.integration


def _features_for(crop, base):
    row = {col: 0.0 for col in _feature_cols[crop]}
    for k, v in base.items():
        if k in row:
            row[k] = v
    return row


def test_list_crops_returns_ten_supported(client):
    resp = client.get("/api/crops")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert len(body["crops"]) == 10
    assert "rice" in body["crops"]


def test_crop_schema_returns_feature_list(client):
    resp = client.get("/api/crops/rice/schema")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["crop"] == "rice"
    assert isinstance(body["features"], list)
    assert len(body["features"]) > 0


def test_crop_schema_unknown_crop_returns_404(client):
    resp = client.get("/api/crops/banana/schema")
    assert resp.status_code == 404


def test_crop_districts_returns_list(client):
    resp = client.get("/api/crops/rice/districts")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["crop"] == "rice"
    assert isinstance(body["districts"], list)
    assert len(body["districts"]) > 0
    assert "code" in body["districts"][0]


def test_crop_districts_unknown_crop_returns_404(client):
    resp = client.get("/api/crops/banana/districts")
    assert resp.status_code == 404


def test_crop_trend_requires_dist_code(client):
    resp = client.get("/api/crops/rice/trend")
    assert resp.status_code == 400


def test_crop_trend_unknown_crop_returns_404(client):
    resp = client.get("/api/crops/banana/trend?dist_code=225")
    assert resp.status_code == 404


def test_crop_trend_returns_series(client):
    resp = client.get("/api/crops/rice/trend?dist_code=225")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["crop"] == "rice"
    assert isinstance(body["trend"], list)


def test_model_info_returns_all_crops(client):
    resp = client.get("/api/model-info")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert "rice" in body
    assert "feature_count" in body["rice"]


def test_district_crop_summary_known_dist(client):
    resp = client.get("/api/districts/225/crops")
    assert resp.status_code in (200, 404)
    if resp.status_code == 200:
        body = json.loads(resp.data)
        assert body["dist_code"] == 225
        assert isinstance(body["crops"], list)


def test_district_crop_summary_unknown_returns_404(client):
    resp = client.get("/api/districts/99999/crops")
    assert resp.status_code == 404


def test_rank_crops_endpoint(client, rice_features):
    resp = client.post("/api/crops/rank",
                       data=json.dumps({"features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert len(body["ranked"]) == 10


def test_rank_crops_accepts_dist_code(client, rice_features):
    resp = client.post("/api/crops/rank",
                       data=json.dumps({"features": rice_features, "dist_code": 225}),
                       content_type="application/json")
    assert resp.status_code == 200
    assert json.loads(resp.data)["dist_code"] == 225


def test_sensitivity_endpoint(client, rice_features):
    resp = client.post("/api/sensitivity",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert "sensitivity" in body
    assert "base_yield" in body


def test_sensitivity_unknown_crop_returns_404(client, rice_features):
    resp = client.post("/api/sensitivity",
                       data=json.dumps({"crop": "banana", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 404


def test_monte_carlo_endpoint(client, rice_features):
    resp = client.post("/api/montecarlo",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["p10"] <= body["p50"] <= body["p90"]


def test_monte_carlo_unknown_crop_returns_404(client, rice_features):
    resp = client.post("/api/montecarlo",
                       data=json.dumps({"crop": "banana", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 404


def test_risk_compare_endpoint(client, rice_features):
    resp = client.post("/api/crops/risk-compare",
                       data=json.dumps({"features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert len(body["crops"]) == 10


def test_season_conditions_endpoint(client, rice_features):
    resp = client.post("/api/crops/season-conditions",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["overall"] in ("favourable", "mixed", "challenging")


def test_season_conditions_unknown_crop_returns_404(client, rice_features):
    resp = client.post("/api/crops/season-conditions",
                       data=json.dumps({"crop": "banana", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 404


def test_optimize_inputs_endpoint(client, rice_features):
    resp = client.post("/api/optimize-inputs",
                       data=json.dumps({"crop": "rice", "features": rice_features, "dist_code": 225}),
                       content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert "already_green" in body


def test_optimize_inputs_unknown_crop_returns_404(client, rice_features):
    resp = client.post("/api/optimize-inputs",
                       data=json.dumps({"crop": "banana", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 404


def test_crop_backtest_endpoint(client):
    resp = client.get("/api/crops/rice/backtest?dist_code=225")
    assert resp.status_code in (200, 404)
    if resp.status_code == 200:
        body = json.loads(resp.data)
        assert body["crop"] == "rice"
        assert "backtest" in body


def test_crop_backtest_missing_dist_code_returns_400(client):
    resp = client.get("/api/crops/rice/backtest")
    assert resp.status_code == 400


def test_crop_backtest_unknown_crop_returns_404(client):
    resp = client.get("/api/crops/banana/backtest?dist_code=225")
    assert resp.status_code == 404