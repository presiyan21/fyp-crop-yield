import json
from unittest.mock import patch
import pytest

from tests._mocks import make_fake_supabase, patch_auth, FakeQuery

pytestmark = pytest.mark.integration


AUTH_HEADERS = {"Authorization": "Bearer mock-token"}


# /api/recommend — POST
def test_recommend_happy_path(client, rice_features):
    fake_sb = make_fake_supabase({
        "user_thresholds": [],
        "recommendations": [],
    })
    payload = {"crop": "rice", "features": rice_features, "dist_code": 225}

    with patch_auth(), \
         patch("routes.recommend.create_client", return_value=fake_sb), \
         patch("routes.recommend.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommend",
                           data=json.dumps(payload),
                           headers=AUTH_HEADERS,
                           content_type="application/json")

    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["crop"] == "rice"
    assert body["level"] in ("red", "amber", "green")
    assert body["recommendation_id"] == "mock-id-123"
    assert body["dist_code"] == 225


def test_recommend_unknown_crop_returns_400(client, rice_features):
    fake_sb = make_fake_supabase({"user_thresholds": [], "recommendations": []})
    payload = {"crop": "banana", "features": rice_features}

    with patch_auth(), \
         patch("routes.recommend.create_client", return_value=fake_sb), \
         patch("routes.recommend.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommend",
                           data=json.dumps(payload),
                           headers=AUTH_HEADERS,
                           content_type="application/json")
    assert resp.status_code == 400


def test_recommend_applies_user_thresholds(client, rice_features):
    custom_row = {
        "user_id": "test-user-uuid",
        "irrigation_min": 0.8,
        "npk_min": 120.0,
        "crop_overrides": {},
    }
    fake_sb = make_fake_supabase({
        "user_thresholds": [custom_row],
        "recommendations": [],
    })
    features = {**rice_features, "IRRIGATION_RATIO": 0.5}  # below the 0.8 override

    with patch_auth(), \
         patch("routes.recommend.create_client", return_value=fake_sb), \
         patch("routes.recommend.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommend",
                           data=json.dumps({"crop": "rice", "features": features, "dist_code": 225}),
                           headers=AUTH_HEADERS,
                           content_type="application/json")

    assert resp.status_code == 200
    body = json.loads(resp.data)
    # With a 0.8 threshold and actual 0.5, irrigation action should fire
    assert any("irrigation" in a.lower() or "water" in a.lower() for a in body["actions"])


def test_recommend_accepts_advisory(client):
    fake_sb = make_fake_supabase({
        "recommendations": [{"id": "rec-1", "user_id": "test-user-uuid", "status": "pending"}],
    })
    with patch_auth(), \
         patch("routes.recommend.get_supabase", return_value=fake_sb):
        resp = client.patch("/api/recommendations/rec-1/accept",
                            headers=AUTH_HEADERS,
                            content_type="application/json")
    assert resp.status_code == 200
    assert json.loads(resp.data)["success"] is True


# /api/history — GET
def test_history_returns_user_recommendations(client):
    recs = [
        {"id": "r1", "user_id": "test-user-uuid", "crop": "rice", "level": "green",
         "predicted_yield": 2100.0, "hist_median": 1900.0, "actions": [],
         "status": "pending", "accepted_at": None, "created_at": "2025-01-01",
         "dist_code": 225, "district_name": "Lucknow", "season_score": 100,
         "inputs": {}, "applied_thresholds": {}}
    ]
    fake_sb = make_fake_supabase({
        "profiles": [{"role": "user"}],
        "recommendations": recs,
        "yield_reports": [],
    })
    with patch_auth(), \
         patch("routes.history.get_supabase", return_value=fake_sb):
        resp = client.get("/api/history", headers=AUTH_HEADERS)

    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["is_admin"] is False
    assert len(body["recommendations"]) == 1
    assert body["recommendations"][0]["crop"] == "rice"


def test_history_admin_flag_set(client):
    fake_sb = make_fake_supabase({
        "profiles": [{"role": "admin"}],
        "recommendations": [],
        "yield_reports": [],
    })
    with patch_auth(), \
         patch("routes.history.get_supabase", return_value=fake_sb):
        resp = client.get("/api/history", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert json.loads(resp.data)["is_admin"] is True


# /api/settings — GET / PUT / DELETE
def test_settings_get_returns_defaults_for_new_user(client):
    fake_sb = make_fake_supabase({"user_thresholds": []})
    with patch_auth(), \
         patch("routes.settings.get_supabase", return_value=fake_sb):
        resp = client.get("/api/settings", headers=AUTH_HEADERS)

    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["is_custom"] is False
    assert body["thresholds"]["irrigation_min"] == 0.3


def test_settings_get_returns_custom_thresholds(client):
    fake_sb = make_fake_supabase({
        "user_thresholds": [{
            "user_id": "test-user-uuid",
            "irrigation_min": 0.7, "npk_min": 100.0,
            "rainfall_dev_low": -15.0, "rainfall_dev_high": 30.0,
            "heat_stress_max": 1.5,
            "crop_overrides": {"rice": {"irrigation_min": 0.9}},
        }],
    })
    with patch_auth(), \
         patch("routes.settings.get_supabase", return_value=fake_sb):
        resp = client.get("/api/settings", headers=AUTH_HEADERS)

    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["is_custom"] is True
    assert body["thresholds"]["irrigation_min"] == 0.7
    assert "rice" in body["crop_overrides"]


def test_settings_put_accepts_valid_payload(client):
    fake_sb = make_fake_supabase({"user_thresholds": []})
    payload = {"irrigation_min": 0.5, "npk_min": 75.0}
    with patch_auth(), \
         patch("routes.settings.get_supabase", return_value=fake_sb):
        resp = client.put("/api/settings",
                          data=json.dumps(payload),
                          headers=AUTH_HEADERS,
                          content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["success"] is True
    assert body["thresholds"]["irrigation_min"] == 0.5


def test_settings_put_rejects_non_numeric(client):
    fake_sb = make_fake_supabase({"user_thresholds": []})
    with patch_auth(), \
         patch("routes.settings.get_supabase", return_value=fake_sb):
        resp = client.put("/api/settings",
                          data=json.dumps({"irrigation_min": "not-a-number"}),
                          headers=AUTH_HEADERS,
                          content_type="application/json")
    assert resp.status_code == 400


def test_settings_put_rejects_empty_payload(client):
    fake_sb = make_fake_supabase({"user_thresholds": []})
    with patch_auth(), \
         patch("routes.settings.get_supabase", return_value=fake_sb):
        resp = client.put("/api/settings",
                          data=json.dumps({}),
                          headers=AUTH_HEADERS,
                          content_type="application/json")
    assert resp.status_code == 400


def test_settings_put_ignores_unknown_keys(client):
    fake_sb = make_fake_supabase({"user_thresholds": []})
    payload = {"irrigation_min": 0.5, "malicious_key": "evil"}
    with patch_auth(), \
         patch("routes.settings.get_supabase", return_value=fake_sb):
        resp = client.put("/api/settings",
                          data=json.dumps(payload),
                          headers=AUTH_HEADERS,
                          content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert "malicious_key" not in body["thresholds"]


def test_settings_delete_resets_to_defaults(client):
    fake_sb = make_fake_supabase({"user_thresholds": []})
    with patch_auth(), \
         patch("routes.settings.get_supabase", return_value=fake_sb):
        resp = client.delete("/api/settings", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["success"] is True
    assert body["thresholds"]["irrigation_min"] == 0.3


# /api/recommendations/<id>/report-yield — POST  |  /api/yield-reports — GET (admin)
def test_report_yield_rejects_missing_actual(client):
    fake_sb = make_fake_supabase({"recommendations": []})
    with patch_auth(), \
         patch("routes.yield_reports.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommendations/rec-1/report-yield",
                           data=json.dumps({}),
                           headers=AUTH_HEADERS,
                           content_type="application/json")
    assert resp.status_code == 400


def test_report_yield_rejects_non_numeric(client):
    fake_sb = make_fake_supabase({"recommendations": []})
    with patch_auth(), \
         patch("routes.yield_reports.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommendations/rec-1/report-yield",
                           data=json.dumps({"actual_yield": "abc"}),
                           headers=AUTH_HEADERS,
                           content_type="application/json")
    assert resp.status_code == 400


def test_report_yield_rejects_negative(client):
    fake_sb = make_fake_supabase({"recommendations": []})
    with patch_auth(), \
         patch("routes.yield_reports.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommendations/rec-1/report-yield",
                           data=json.dumps({"actual_yield": -500}),
                           headers=AUTH_HEADERS,
                           content_type="application/json")
    assert resp.status_code == 400


def test_report_yield_rejects_unrealistic_high(client):
    fake_sb = make_fake_supabase({"recommendations": []})
    with patch_auth(), \
         patch("routes.yield_reports.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommendations/rec-1/report-yield",
                           data=json.dumps({"actual_yield": 50000, "crop": "rice"}),
                           headers=AUTH_HEADERS,
                           content_type="application/json")
    assert resp.status_code == 400


def test_report_yield_rejects_unknown_recommendation(client):
    fake_sb = make_fake_supabase({"recommendations": []})
    with patch_auth(), \
         patch("routes.yield_reports.get_supabase", return_value=fake_sb):
        resp = client.post("/api/recommendations/missing-id/report-yield",
                           data=json.dumps({"actual_yield": 2000, "crop": "rice"}),
                           headers=AUTH_HEADERS,
                           content_type="application/json")
    assert resp.status_code == 404


def test_yield_reports_list_requires_admin(client):
    fake_sb = make_fake_supabase({"profiles": [{"role": "user"}]})
    with patch_auth(), \
         patch("routes.yield_reports.get_supabase", return_value=fake_sb):
        resp = client.get("/api/yield-reports", headers=AUTH_HEADERS)
    assert resp.status_code == 403


def test_yield_reports_list_admin_empty(client):
    fake_sb = make_fake_supabase({
        "profiles": [{"role": "admin"}],
        "yield_reports": [],
    })
    with patch_auth(), \
         patch("routes.yield_reports.get_supabase", return_value=fake_sb):
        resp = client.get("/api/yield-reports", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["reports"] == []