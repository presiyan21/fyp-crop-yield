import json
import pytest

pytestmark = pytest.mark.integration


def test_health_returns_200(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200


def test_predict_valid_payload_returns_200(client, rice_features):
    payload = {"crop": "rice", "features": rice_features}
    resp = client.post("/api/predict", data=json.dumps(payload), content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert "predicted_yield" in body


def test_predict_invalid_crop_returns_400(client, rice_features):
    payload = {"crop": "banana", "features": rice_features}
    resp = client.post("/api/predict", data=json.dumps(payload), content_type="application/json")
    assert resp.status_code == 400


def test_predict_missing_crop_returns_400(client):
    resp = client.post("/api/predict", data=json.dumps({"features": {}}), content_type="application/json")
    assert resp.status_code == 400
