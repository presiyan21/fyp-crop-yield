import json
import pytest
from services.model_service import (
    predict,
    generate_advisory,
    rank_all_crops,
    monte_carlo_uncertainty,
    sensitivity_analysis,
)

pytestmark = pytest.mark.smoke


def test_end_to_end_happy_path(client, rice_features):
    """One test, end to end, covering every major subsystem."""

    # 1. App is up
    resp = client.get("/api/health")
    assert resp.status_code == 200, "Health check failed — Flask app is not responding"
    assert json.loads(resp.data)["crops_loaded"] == 10

    # 2. Model inference works for the canonical crop
    raw_yield = predict("rice", rice_features)
    assert raw_yield > 0, "Raw predict() returned non-positive yield"

    # 3. Full advisory pipeline runs without error
    advisory = generate_advisory("rice", rice_features)
    assert advisory["level"] in ("red", "amber", "green")
    assert advisory["predicted_yield"] > 0
    assert len(advisory["actions"]) >= 1

    # 4. Cross-crop comparison works
    ranked = rank_all_crops(rice_features)
    assert len(ranked) == 10, "Expected ranking for all 10 crops"
    assert all("predicted_yield" in r for r in ranked)

    # 5. Uncertainty quantification works
    mc = monte_carlo_uncertainty("rice", rice_features, n=50)
    assert mc["n_simulations"] == 50
    assert mc["p10"] <= mc["p50"] <= mc["p90"]

    # 6. Sensitivity analysis works
    sens = sensitivity_analysis("rice", rice_features)
    assert sens["base_yield"] > 0
    assert len(sens["sensitivity"]) > 0

    # 7. Full API round-trip works
    resp = client.post("/api/predict",
                       data=json.dumps({"crop": "rice", "features": rice_features}),
                       content_type="application/json")
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["predicted_yield"] > 0
    assert body["crop"] == "rice"