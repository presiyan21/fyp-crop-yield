import pytest
from services.model_service import (
    get_hist_q25_for_district,
    optimize_inputs,
    _find_combined_path,
    _feature_cols,
    _feature_ranges,
)

pytestmark = pytest.mark.unit


# get_hist_q25_for_district — district-miss fallback path
def test_hist_q25_unknown_district_falls_back_to_national():
    q25 = get_hist_q25_for_district("rice", 999999)
    assert isinstance(q25, float)
    assert q25 > 0


def test_hist_q25_none_dist_code_returns_none():
    assert get_hist_q25_for_district("rice", None) is None


def test_hist_q25_unknown_crop_returns_none():
    assert get_hist_q25_for_district("banana", 225) is None


# optimize_inputs — feasible-with-gap path (low irrigation + NPK forces base_pred < hist_median)
def _low_input_features(crop):
    """Feature row likely scoring below hist_median — user fields set very low."""
    cols   = _feature_cols[crop]
    ranges = _feature_ranges.get(crop, {})
    row = {}
    for col in cols:
        if col in ranges:
            row[col] = float(ranges[col]["mean"])
        else:
            row[col] = 0.0
    row["IRRIGATION_RATIO"]    = 0.05
    row["NPK_TOTAL_KG_PER_HA"] = 10.0
    row["YIELD_LAG_1"]         = 500.0
    row["YIELD_LAG_3"]         = 500.0
    return row


def test_optimize_inputs_produces_feasible_recommendations():
    features = _low_input_features("rice")
    result = optimize_inputs("rice", features, dist_code=225)

    if result["already_green"]:
        pytest.skip("Low-input setup still exceeds median for this district — try another")

    assert result["already_green"] is False
    assert "optimizations" in result
    assert len(result["optimizations"]) >= 1
    assert result["gap"] > 0
    assert result["base_yield"] < result["target_yield"]

    for opt in result["optimizations"]:
        assert "field" in opt
        assert "feasible" in opt
        if opt["feasible"]:
            assert opt["recommended"] > opt["current"]
            assert opt["new_yield"] > 0
            assert "yield_gain" in opt
            assert "change_pct" in opt


def test_optimize_inputs_combined_path_when_feasible():
    features = _low_input_features("rice")
    result = optimize_inputs("rice", features, dist_code=225)

    if result["already_green"]:
        pytest.skip("Low-input setup still exceeds median — combined path not exercised")

    if result["combined_path"] is not None:
        cp = result["combined_path"]
        assert cp["irr_recommended"] >= cp["irr_current"]
        assert cp["npk_recommended"] >= cp["npk_current"]
        assert cp["new_yield"] > result["base_yield"]
        assert cp["yield_gain"] > 0


# _find_combined_path — infeasibility path (target set beyond max_irr + max_npk)
def test_find_combined_path_returns_none_when_impossible():
    features = _low_input_features("rice")
    impossible_target = 1_000_000  # nothing can reach this
    result = _find_combined_path("rice", features, target=impossible_target)
    assert result is None


# optimize_inputs — already_green early-exit: short-circuit returns documented shape
def test_optimize_already_green_returns_correct_shape(rice_features):
    result = optimize_inputs("rice", rice_features)
    if not result["already_green"]:
        pytest.skip("Base rice_features fixture is not already-green for this crop")

    assert result["already_green"] is True
    assert result["optimizations"] == []
    assert "base_yield" in result
    assert "target_yield" in result
    assert result["base_yield"] >= result["target_yield"]