import pytest
from services.model_service import risk_compare_all_crops

pytestmark = pytest.mark.unit


def test_risk_compare_returns_all_crops(rice_features):
    results = risk_compare_all_crops(rice_features, n=100)
    assert len(results) == 10


def test_risk_compare_required_keys(rice_features):
    results = risk_compare_all_crops(rice_features, n=100)
    required = {
        "crop", "predicted_yield", "p10", "p50", "p90",
        "hist_median", "hist_q25", "level", "red_probability",
        "msp", "expected_revenue", "worst_revenue", "best_revenue", "risk_adjusted",
    }
    for r in results:
        assert required <= r.keys(), f"Missing keys in {r['crop']} result"


def test_risk_compare_sorted_by_risk_adjusted(rice_features):
    results = risk_compare_all_crops(rice_features, n=100)
    scores = [r["risk_adjusted"] for r in results]
    assert scores == sorted(scores, reverse=True)


def test_risk_compare_valid_levels(rice_features):
    results = risk_compare_all_crops(rice_features, n=100)
    for r in results:
        assert r["level"] in ("red", "amber", "green"), \
            f"Invalid level '{r['level']}' for {r['crop']}"
