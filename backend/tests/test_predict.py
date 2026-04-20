import pytest
from services.model_service import predict

pytestmark = pytest.mark.unit

def test_predict_returns_positive_float(rice_features):
    result = predict("rice", rice_features)
    assert isinstance(result, float)
    assert result > 0

def test_predict_invalid_crop_raises(rice_features):
    with pytest.raises(KeyError):
        predict("banana", rice_features)

def test_predict_empty_features_raises():
    with pytest.raises(Exception):
        predict("rice", {})
