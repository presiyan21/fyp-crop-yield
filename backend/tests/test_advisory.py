import pytest
from services.model_service import generate_advisory

pytestmark = pytest.mark.unit

REQUIRED_KEYS = {
    "crop", "predicted_yield", "hist_median", "hist_q25", "hist_q75",
    "level", "headline", "actions", "shap_top10", "shap_local",
    "ood_warnings", "conformal_interval", "backtest_adf",
}

def test_advisory_returns_required_keys(rice_features):
    result = generate_advisory("rice", rice_features, dist_code=None)
    assert REQUIRED_KEYS.issubset(result.keys())

def test_advisory_level_is_valid(rice_features):
    result = generate_advisory("rice", rice_features)
    assert result["level"] in ("red", "amber", "green")

def test_advisory_actions_nonempty(rice_features):
    result = generate_advisory("rice", rice_features)
    assert isinstance(result["actions"], list)
    assert len(result["actions"]) >= 1

def test_advisory_crop_override_applies(rice_features):
    # With a very high irrigation_min override, irr_low action should fire
    overrides = {"rice": {"irrigation_min": 0.99}}
    low_irr = {**rice_features, "IRRIGATION_RATIO": 0.1}
    result = generate_advisory("rice", low_irr, crop_overrides=overrides)
    assert any("irrigation" in a.lower() for a in result["actions"])

def test_advisory_predicted_yield_positive(rice_features):
    result = generate_advisory("rice", rice_features)
    assert result["predicted_yield"] > 0
