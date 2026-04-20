import json
import pytest
from services.model_service import predict, generate_advisory, _feature_cols
from config import SUPPORTED_CROPS

pytestmark = pytest.mark.equivalence


def _build_features_for(crop, base):
    """Build a valid feature dict for any crop, zero-padding crop-specific columns."""
    row = {col: 0.0 for col in _feature_cols[crop]}
    for k, v in base.items():
        if k in row:
            row[k] = v
    return row


# Crop name partitions
@pytest.mark.parametrize("crop", SUPPORTED_CROPS)
def test_supported_crops_produce_positive_yield(crop, rice_features):
    features = _build_features_for(crop, rice_features)
    result = predict(crop, features)
    assert isinstance(result, float)
    assert result > 0


@pytest.mark.parametrize("bad_crop", ["banana", "tomato", "", "rice_v2", "RiCe"])
def test_unsupported_crop_string_raises(bad_crop, rice_features):
    with pytest.raises((KeyError, ValueError)):
        predict(bad_crop, rice_features)


# Feature dict partitions
def test_empty_features_raises():
    with pytest.raises(Exception):
        predict("rice", {})


def test_missing_required_columns_raises(rice_features):
    incomplete = {k: v for i, (k, v) in enumerate(rice_features.items()) if i < 5}
    with pytest.raises(Exception):
        predict("rice", incomplete)


def test_extra_columns_are_ignored(rice_features):
    extended = {**rice_features, "NOT_A_REAL_COLUMN": 9999.0, "ANOTHER_FAKE": -1.0}
    result = predict("rice", extended)
    assert isinstance(result, float)
    assert result > 0


# Numeric type partitions for a single field
def test_irrigation_normal_value(rice_features):
    result = predict("rice", {**rice_features, "IRRIGATION_RATIO": 0.5})
    assert result > 0


def test_irrigation_zero(rice_features):
    result = predict("rice", {**rice_features, "IRRIGATION_RATIO": 0.0})
    assert result > 0


def test_irrigation_negative_still_runs(rice_features):
    # The model does not enforce input sanity; the OOD flag is the guardrail.
    result = predict("rice", {**rice_features, "IRRIGATION_RATIO": -1.0})
    assert isinstance(result, float)


def test_extreme_rainfall_triggers_ood_warning(rice_features):
    extreme = {**rice_features, "ANNUAL RAINFALL (Millimeters)": 100000.0}
    advisory = generate_advisory("rice", extreme)
    assert any("Rainfall" in w or "rainfall" in w.lower() for w in advisory["ood_warnings"])


# Advisory level output partitions
@pytest.mark.parametrize("variant", [
    {"IRRIGATION_RATIO": 0.1, "NPK_TOTAL_KG_PER_HA": 20.0},
    {"IRRIGATION_RATIO": 0.5, "NPK_TOTAL_KG_PER_HA": 80.0},
    {"IRRIGATION_RATIO": 0.9, "NPK_TOTAL_KG_PER_HA": 200.0},
])
def test_advisory_level_always_one_of_three(variant, rice_features):
    features = {**rice_features, **variant}
    result = generate_advisory("rice", features)
    assert result["level"] in ("red", "amber", "green")


# JSON payload partitions for /api/predict
def test_valid_payload_returns_200(client, rice_features):
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200


def test_missing_crop_returns_400(client, rice_features):
    resp = client.post("/api/predict",
                       data=json.dumps({"features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 400


def test_unsupported_crop_returns_400(client, rice_features):
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "banana", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 400


def test_empty_features_returns_400(client):
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "rice", "features": {}}),
                       content_type="application/json")
    assert resp.status_code == 400


def test_malformed_json_returns_error(client):
    resp = client.post("/api/predict",
                       data="{not valid json",
                       content_type="application/json")
    assert resp.status_code in (400, 500)