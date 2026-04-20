import pytest
from services.model_service import compute_season_conditions

pytestmark = pytest.mark.unit


def test_season_conditions_required_keys(rice_features):
    result = compute_season_conditions("rice", rice_features)
    assert "overall" in result
    assert "signals" in result
    assert "key_driver_label" in result
    assert "key_driver_diff" in result


def test_season_conditions_overall_values(rice_features):
    result = compute_season_conditions("rice", rice_features)
    assert result["overall"] in ("favourable", "mixed", "challenging")


def test_season_conditions_signal_structure(rice_features):
    result = compute_season_conditions("rice", rice_features)
    for s in result["signals"]:
        assert "label" in s
        assert "z_score" in s
        assert s["status"] in ("normal", "watch", "challenging")


def test_season_conditions_challenging_detected():
    # Extreme inputs to force at least one challenging signal
    extreme = {
        "ANNUAL RAINFALL (Millimeters)": 50.0,   # far below any training mean
        "KHARIF_TMAX": 46.0,                      # severe heat
        "RABI_TMIN": 1.0,                         # severe cold
    }
    result = compute_season_conditions("rice", extreme)
    statuses = {s["status"] for s in result["signals"]}
    assert "challenging" in statuses
