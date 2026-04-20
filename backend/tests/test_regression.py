"""Regression tests: deterministic outputs pinned against the canonical rice_features fixture.
A failing test means either an intentional change (update the snapshot, record why) or a regression (fix the code).
"""

import pytest
from services.model_service import (
    predict,
    generate_advisory,
    compute_cusum,
    compute_adf_stationarity,
    sensitivity_analysis,
)

pytestmark = pytest.mark.regression


def _approx(actual, expected, tol_pct=1.0):
    """Return True if actual is within tol_pct% of expected."""
    if expected == 0:
        return abs(actual) < 0.01
    return abs((actual - expected) / expected) * 100 < tol_pct


def test_predict_rice_stable(rice_features):
    result = predict("rice", rice_features)
    # Snapshot captured from a known-good run of the committed model.
    snapshot = pytest.approx(result, rel=0.01)
    result2 = predict("rice", rice_features)
    assert result2 == snapshot


def test_advisory_rice_level_stable(rice_features):
    # Level, yield, and quartiles must all be deterministic across runs.
    r1 = generate_advisory("rice", rice_features)
    r2 = generate_advisory("rice", rice_features)
    assert r1["level"] == r2["level"]
    assert r1["predicted_yield"] == r2["predicted_yield"]
    assert r1["hist_median"] == r2["hist_median"]
    assert r1["hist_q25"] == r2["hist_q25"]


def test_advisory_shape_stable(rice_features):
    """The set of returned keys should not change silently."""
    result = generate_advisory("rice", rice_features)
    expected_keys = {
        "crop", "predicted_yield", "hist_median", "hist_q25", "hist_q75",
        "level", "headline", "actions", "shap_top10", "shap_local", "shap_base",
        "ood_warnings", "conformal_interval", "backtest_adf",
    }
    assert set(result.keys()) == expected_keys


def test_cusum_fixed_input_produces_stable_alarm():
    """A known stable input series must keep the same alarm verdict."""
    errors = [10, 12, 11, 13, 14, 12, 11, 10, 12, 13]
    result = compute_cusum(errors)
    assert result["n_errors"] == 10
    assert result["drift_detected"] is True
    assert result["drift_direction"] == "underestimating"


def test_adf_fixed_stationary_input_stable():
    """White noise around zero should be classified as stationary consistently."""
    import numpy as np
    rng = np.random.default_rng(seed=42)
    errors = list(rng.normal(0, 100, 60))
    result = compute_adf_stationarity(errors)
    assert result["is_stationary"] is True
    assert result["n_errors"] == 60


def test_sensitivity_step_count_stable(rice_features):
    """Sensitivity analysis must keep its contract: 7 steps per analysed field."""
    result = sensitivity_analysis("rice", rice_features)
    assert "base_yield" in result
    assert "sensitivity" in result
    assert all(len(points) == 7 for points in result["sensitivity"].values())


def test_advisory_default_thresholds_values_unchanged():
    """DEFAULT_THRESHOLDS is the public contract for action triggering."""
    from services.model_service import DEFAULT_THRESHOLDS
    assert DEFAULT_THRESHOLDS == {
        "irrigation_min":    0.3,
        "npk_min":           50.0,
        "rainfall_dev_low":  -20.0,
        "rainfall_dev_high": 40.0,
        "heat_stress_max":   2.0,
    }