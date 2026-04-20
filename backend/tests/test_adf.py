import pytest
from services.model_service import compute_adf_stationarity

pytestmark = pytest.mark.unit

def test_adf_short_series_returns_gracefully():
    result = compute_adf_stationarity([1, 2, 3])
    assert result["is_stationary"] is None
    assert "Insufficient" in result["interpretation"]

def test_adf_returns_stationarity_key(random_errors):
    result = compute_adf_stationarity(random_errors)
    assert isinstance(result["is_stationary"], bool)
    assert result["adf_stat"] is not None
    assert result["p_value"] is not None

def test_adf_stationary_series():
    # White noise should be stationary
    import numpy as np
    rng = np.random.default_rng(0)
    errors = list(rng.normal(0, 1, 80))
    result = compute_adf_stationarity(errors)
    assert result["is_stationary"] is True
