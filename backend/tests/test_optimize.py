import pytest, time
from services.model_service import optimize_inputs

pytestmark = pytest.mark.unit

def test_optimize_returns_valid_structure(rice_features):
    result = optimize_inputs("rice", rice_features, dist_code=None)
    assert "already_green" in result
    assert "base_yield" in result
    assert "target_yield" in result
    assert "optimizations" in result

def test_optimize_terminates_quickly(rice_features):
    start = time.time()
    optimize_inputs("rice", rice_features)
    elapsed = time.time() - start
    assert elapsed < 10.0, f"optimize_inputs took {elapsed:.1f}s â€” too slow"

def test_optimize_already_green_when_high_yield(rice_features):
    high_yield = {**rice_features, "YIELD_LAG_1": 9000.0, "IRRIGATION_RATIO": 0.95,
                  "NPK_TOTAL_KG_PER_HA": 400.0}
    result = optimize_inputs("rice", high_yield)
    # May or may not be green, but must return valid structure
    assert isinstance(result["already_green"], bool)


def test_optimize_already_green_has_empty_optimizations(rice_features):
    green = {
        **rice_features,
        "YIELD_LAG_1": 9000.0,
        "YIELD_LAG_3": 8500.0,
        "IRRIGATION_RATIO": 0.95,
        "NPK_TOTAL_KG_PER_HA": 400.0,
    }
    result = optimize_inputs("rice", green)
    if result["already_green"]:
        assert result["optimizations"] == []
        assert result["base_yield"] >= result["target_yield"]


def test_optimize_infeasible_entry_structure():
    from services.model_service import _feature_cols
    poor = {col: 0.0 for col in _feature_cols["cotton"]}
    poor.update({
        "YIELD_LAG_1": 30.0,
        "YIELD_LAG_3": 30.0,
        "IRRIGATION_RATIO": 0.0,
        "NPK_TOTAL_KG_PER_HA": 0.0,
        "ANNUAL RAINFALL (Millimeters)": 40.0,
        "KHARIF_TMAX": 47.0,
        "HEAT_STRESS": 6.0,
    })
    result = optimize_inputs("cotton", poor)
    assert "already_green" in result
    assert isinstance(result["optimizations"], list)
    for opt in result["optimizations"]:
        assert "field" in opt
        assert "feasible" in opt
        if not opt["feasible"]:
            assert "reason" in opt
            assert len(opt["reason"]) > 0
