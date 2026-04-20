import pytest
from services.model_service import (
    monte_carlo_uncertainty, rank_all_crops,
    get_national_training_climate, _conformal_quantiles,
)
from config import SUPPORTED_CROPS

pytestmark = pytest.mark.unit

def test_conformal_quantiles_loaded():
    # At least some crops should have calibration data
    loaded = [c for c in SUPPORTED_CROPS if _conformal_quantiles.get(c) is not None]
    assert len(loaded) > 0, "No conformal quantiles loaded â€” check backtest JSON files"

def test_monte_carlo_returns_percentiles(rice_features):
    result = monte_carlo_uncertainty("rice", rice_features, n=200)
    for key in ("p10", "p25", "p50", "p75", "p90"):
        assert key in result
    assert result["p10"] <= result["p50"] <= result["p90"]

def test_monte_carlo_level_probs_sum_to_100(rice_features):
    result = monte_carlo_uncertainty("rice", rice_features, n=200)
    total = sum(result["level_probabilities"].values())
    assert abs(total - 100) <= 2  # allow rounding

def test_rank_all_crops_returns_all_ten(rice_features):
    results = rank_all_crops(rice_features)
    assert len(results) == 10
    crops_returned = {r["crop"] for r in results}
    assert crops_returned == set(SUPPORTED_CROPS)

def test_rank_all_crops_sorted_descending(rice_features):
    results = rank_all_crops(rice_features)
    deltas = [r["delta_pct"] for r in results]
    assert deltas == sorted(deltas, reverse=True)

def test_get_national_training_climate_nonempty():
    result = get_national_training_climate()
    assert isinstance(result, dict)
    assert len(result) > 0
    for key, val in result.items():
        assert "mean" in val and "std" in val
