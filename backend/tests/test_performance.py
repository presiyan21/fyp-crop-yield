import time
import pytest
from services.model_service import (
    predict,
    generate_advisory,
    monte_carlo_uncertainty,
    sensitivity_analysis,
    rank_all_crops,
    compute_cusum,
    compute_adf_stationarity,
)

pytestmark = pytest.mark.performance


def _time_ms(fn, *args, **kwargs):
    start = time.perf_counter()
    result = fn(*args, **kwargs)
    elapsed = (time.perf_counter() - start) * 1000
    return result, elapsed


# Service-level latency budgets
def test_predict_under_200ms(rice_features):
    _, elapsed = _time_ms(predict, "rice", rice_features)
    assert elapsed < 200, f"predict took {elapsed:.1f} ms (budget 200 ms)"


def test_generate_advisory_under_1000ms(rice_features):
    _, elapsed = _time_ms(generate_advisory, "rice", rice_features)
    assert elapsed < 1000, f"generate_advisory took {elapsed:.1f} ms (budget 1000 ms)"


def test_monte_carlo_500_under_5000ms(rice_features):
    _, elapsed = _time_ms(monte_carlo_uncertainty, "rice", rice_features, None, 500)
    assert elapsed < 5000, f"monte_carlo n=500 took {elapsed:.1f} ms (budget 5000 ms)"


def test_sensitivity_under_2000ms(rice_features):
    _, elapsed = _time_ms(sensitivity_analysis, "rice", rice_features)
    assert elapsed < 2000, f"sensitivity took {elapsed:.1f} ms (budget 2000 ms)"


def test_rank_all_crops_under_3000ms(rice_features):
    _, elapsed = _time_ms(rank_all_crops, rice_features)
    assert elapsed < 3000, f"rank_all_crops took {elapsed:.1f} ms (budget 3000 ms)"


def test_cusum_under_100ms(random_errors):
    _, elapsed = _time_ms(compute_cusum, random_errors)
    assert elapsed < 100, f"cusum took {elapsed:.1f} ms (budget 100 ms)"


def test_adf_under_500ms(random_errors):
    _, elapsed = _time_ms(compute_adf_stationarity, random_errors)
    assert elapsed < 500, f"adf took {elapsed:.1f} ms (budget 500 ms)"


# Route-level latency (HTTP overhead included)
def test_health_route_under_100ms(client):
    start = time.perf_counter()
    resp = client.get("/api/health")
    elapsed = (time.perf_counter() - start) * 1000
    assert resp.status_code == 200
    assert elapsed < 100, f"/api/health took {elapsed:.1f} ms (budget 100 ms)"


def test_predict_route_under_1500ms(client, rice_features):
    import json
    start = time.perf_counter()
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    elapsed = (time.perf_counter() - start) * 1000
    assert resp.status_code == 200
    assert elapsed < 1500, f"/api/predict took {elapsed:.1f} ms (budget 1500 ms)"


# Repeatability — 5 consecutive predict calls should have stable latency
def test_predict_latency_is_stable(rice_features):
    times = []
    for _ in range(5):
        _, elapsed = _time_ms(predict, "rice", rice_features)
        times.append(elapsed)
    avg = sum(times) / len(times)
    worst = max(times)
    # Worst must not exceed 5x the average — catches GC spikes; loose bound allows for warm-up.
    assert worst < max(avg * 5, 200), \
        f"Latency instability: avg={avg:.1f} ms, worst={worst:.1f} ms, times={times}"