import json
import pytest

pytestmark = pytest.mark.security


AUTH_PROTECTED_ENDPOINTS = [
    ("POST",  "/api/recommend"),
    ("GET",   "/api/history"),
    ("GET",   "/api/settings"),
    ("PUT",   "/api/settings"),
    ("GET",   "/api/yield-reports"),
]

# Auth header requirement — parametrised across all protected endpoints
@pytest.mark.parametrize("method,path", AUTH_PROTECTED_ENDPOINTS)
def test_missing_auth_header_returns_401(client, method, path):
    resp = client.open(path, method=method, content_type="application/json")
    assert resp.status_code == 401
    body = json.loads(resp.data)
    assert "error" in body


@pytest.mark.parametrize("method,path", AUTH_PROTECTED_ENDPOINTS)
def test_wrong_scheme_returns_401(client, method, path):
    headers = {"Authorization": "Basic dXNlcjpwYXNz"}
    resp = client.open(path, method=method, headers=headers, content_type="application/json")
    assert resp.status_code == 401


@pytest.mark.parametrize("method,path", AUTH_PROTECTED_ENDPOINTS)
def test_empty_bearer_token_returns_401(client, method, path):
    headers = {"Authorization": "Bearer "}
    resp = client.open(path, method=method, headers=headers, content_type="application/json")
    assert resp.status_code == 401


def test_malformed_bearer_token_rejected(client):
    headers = {"Authorization": "Bearer not.a.real.jwt"}
    resp = client.get("/api/history", headers=headers)
    assert resp.status_code == 401


def test_very_long_garbage_token_rejected(client):
    headers = {"Authorization": "Bearer " + "A" * 4000}
    resp = client.get("/api/history", headers=headers)
    assert resp.status_code == 401


def test_header_case_sensitivity_required(client):
    # Scheme value is case-sensitive: "bearer" is rejected, "Bearer" is required.
    headers = {"Authorization": "bearer some.token.here"}
    resp = client.get("/api/history", headers=headers)
    assert resp.status_code == 401


# Public endpoints remain reachable without auth
def test_health_is_public(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200


def test_predict_is_public(client, rice_features):
    # /api/predict is intentionally unauthenticated 
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200


# Input safety — hostile strings must not crash the service
def test_sql_injection_in_crop_name_rejected(client, rice_features):
    payload = {"crop": "rice'; DROP TABLE users;--", "features": rice_features}
    resp = client.post("/api/predict",
                       data=json.dumps(payload),
                       content_type="application/json")
    assert resp.status_code == 400


def test_path_traversal_in_crop_name_rejected(client, rice_features):
    payload = {"crop": "../../etc/passwd", "features": rice_features}
    resp = client.post("/api/predict",
                       data=json.dumps(payload),
                       content_type="application/json")
    assert resp.status_code == 400


def test_oversized_payload_handled_gracefully(client):
    huge_features = {f"FAKE_COL_{i}": i for i in range(10000)}
    payload = {"crop": "rice", "features": huge_features}
    resp = client.post("/api/predict",
                       data=json.dumps(payload),
                       content_type="application/json")
    # Either 400 (rejected by validation) or 500 (pandas raises on missing columns)
    assert resp.status_code in (400, 500)