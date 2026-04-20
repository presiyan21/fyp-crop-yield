import pytest
from services.model_service import compute_cusum

pytestmark = pytest.mark.unit

def test_cusum_empty_input():
    result = compute_cusum([])
    assert result["drift_detected"] is False
    assert result["cusum_pos"] == []
    assert result["cusum_neg"] == []

def test_cusum_single_value():
    result = compute_cusum([100.0])
    assert result["drift_detected"] is False

def test_cusum_no_drift_small_errors(small_errors):
    result = compute_cusum(small_errors)
    assert result["drift_detected"] is False
    assert result["drift_direction"] is None

def test_cusum_drift_detected_large_errors(large_errors):
    result = compute_cusum(large_errors)
    assert result["drift_detected"] is True
    assert result["drift_direction"] == "underestimating"

def test_cusum_returns_correct_structure(small_errors):
    result = compute_cusum(small_errors)
    assert "cusum_pos" in result
    assert "cusum_neg" in result
    assert "threshold" in result
    assert len(result["cusum_pos"]) == len(small_errors)
