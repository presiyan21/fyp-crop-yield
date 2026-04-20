import pytest
from services.model_service import (
    generate_advisory,
    compute_cusum,
    compute_adf_stationarity,
    monte_carlo_uncertainty,
    sensitivity_analysis,
    DEFAULT_THRESHOLDS,
)

pytestmark = pytest.mark.bva

# Strict less-than comparison: value < threshold triggers action, value == threshold does not.
IRR_MIN = DEFAULT_THRESHOLDS["irrigation_min"]  # 0.3
NPK_MIN = DEFAULT_THRESHOLDS["npk_min"]         # 50.0
HEAT_MAX = DEFAULT_THRESHOLDS["heat_stress_max"] # 2.0


def _has_irr_action(result):
    return any("irrigation" in a.lower() or "water" in a.lower() for a in result["actions"])


def _has_npk_action(result):
    return any("fertiliz" in a.lower() or "nitrogen" in a.lower() or "npk" in a.lower() or "feeder" in a.lower()
               for a in result["actions"])


def _has_heat_action(result):
    return any("heat" in a.lower() or "temperature" in a.lower() for a in result["actions"])


def test_irrigation_just_below_min_triggers_action(rice_features):
    features = {**rice_features, "IRRIGATION_RATIO": IRR_MIN - 0.001}
    result = generate_advisory("rice", features)
    assert _has_irr_action(result)


def test_irrigation_at_exact_min_does_not_trigger(rice_features):
    features = {**rice_features, "IRRIGATION_RATIO": IRR_MIN}
    result = generate_advisory("rice", features)
    assert not _has_irr_action(result)


def test_irrigation_just_above_min_does_not_trigger(rice_features):
    features = {**rice_features, "IRRIGATION_RATIO": IRR_MIN + 0.001}
    result = generate_advisory("rice", features)
    assert not _has_irr_action(result)


def test_npk_just_below_min_triggers_action(rice_features):
    features = {**rice_features, "NPK_TOTAL_KG_PER_HA": NPK_MIN - 0.1}
    result = generate_advisory("rice", features)
    assert _has_npk_action(result)


def test_npk_at_exact_min_does_not_trigger(rice_features):
    features = {**rice_features, "NPK_TOTAL_KG_PER_HA": NPK_MIN}
    result = generate_advisory("rice", features)
    assert not _has_npk_action(result)


def test_heat_just_above_max_triggers_action(rice_features):
    features = {**rice_features, "HEAT_STRESS": HEAT_MAX + 0.01}
    result = generate_advisory("rice", features)
    assert _has_heat_action(result)


def test_heat_at_exact_max_does_not_trigger(rice_features):
    features = {**rice_features, "HEAT_STRESS": HEAT_MAX}
    result = generate_advisory("rice", features)
    assert not _has_heat_action(result)


# Input extremes for user-controllable fields
def test_irrigation_zero_lower_bound(rice_features):
    features = {**rice_features, "IRRIGATION_RATIO": 0.0}
    result = generate_advisory("rice", features)
    assert result["predicted_yield"] > 0


def test_irrigation_one_upper_bound(rice_features):
    features = {**rice_features, "IRRIGATION_RATIO": 1.0}
    result = generate_advisory("rice", features)
    assert result["predicted_yield"] > 0


def test_npk_zero_triggers_npk_action(rice_features):
    features = {**rice_features, "NPK_TOTAL_KG_PER_HA": 0.0}
    result = generate_advisory("rice", features)
    assert _has_npk_action(result)


# CUSUM array-size boundaries
def test_cusum_length_zero_returns_stub():
    result = compute_cusum([])
    assert result["drift_detected"] is False
    assert result["threshold"] is None
    assert result["n_errors"] == 0


def test_cusum_length_one_returns_stub():
    result = compute_cusum([10.0])
    assert result["drift_detected"] is False
    assert result["threshold"] is None
    assert result["n_errors"] == 1


def test_cusum_length_two_runs_full_computation():
    result = compute_cusum([10.0, -10.0])
    assert result["threshold"] is not None
    assert result["n_errors"] == 2
    assert len(result["cusum_pos"]) == 2


# ADF array-size boundaries
def test_adf_length_four_returns_insufficient_stub():
    result = compute_adf_stationarity([1.0, -1.0, 0.5, -0.5])
    assert result["p_value"] is None
    assert result["is_stationary"] is None
    assert "Insufficient" in result["interpretation"]


def test_adf_length_five_runs_real_test():
    result = compute_adf_stationarity([1.0, -1.0, 0.5, -0.5, 0.2])
    assert result["p_value"] is not None
    assert isinstance(result["is_stationary"], bool)


# Monte Carlo n parameter
def test_monte_carlo_n_one_returns_single_simulation(rice_features):
    result = monte_carlo_uncertainty("rice", rice_features, n=1)
    assert result["n_simulations"] == 1


def test_monte_carlo_n_small_does_not_error(rice_features):
    result = monte_carlo_uncertainty("rice", rice_features, n=10)
    assert result["n_simulations"] == 10
    assert sum(result["level_probabilities"].values()) >= 98  # rounded to 100 ± 2


# Sensitivity step count 7 steps: [-30, -20, -10, 0, 10, 20, 30]
def test_sensitivity_produces_exactly_seven_steps_per_field(rice_features):
    result = sensitivity_analysis("rice", rice_features)
    for field, points in result["sensitivity"].items():
        assert len(points) == 7, f"{field} expected 7 steps, got {len(points)}"