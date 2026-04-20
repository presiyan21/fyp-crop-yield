import pytest
from services.model_service import sensitivity_analysis

pytestmark = pytest.mark.unit

def test_sensitivity_returns_dict(rice_features):
    result = sensitivity_analysis("rice", rice_features)
    assert "sensitivity" in result
    assert "base_yield" in result

def test_sensitivity_base_yield_positive(rice_features):
    result = sensitivity_analysis("rice", rice_features)
    assert result["base_yield"] > 0

def test_sensitivity_steps_shape(rice_features):
    result = sensitivity_analysis("rice", rice_features)
    for key, pts in result["sensitivity"].items():
        assert len(pts) == 7, f"{key} should have 7 steps (-30% to +30%)"
        pcts = [p["pct"] for p in pts]
        assert -30 in pcts and 30 in pcts
