import sys, os, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.model_service import _feature_cols
from app import create_app


@pytest.fixture(scope="session")
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(scope="session")
def rice_features():
    row = {col: 0.0 for col in _feature_cols["rice"]}
    row.update({
        "YIELD_LAG_1":                   1500.0,
        "YIELD_LAG_3":                   1400.0,
        "YEAR_TREND":                    45.0,
        "DECADE":                        2010.0,
        "IRRIGATION_RATIO":              0.4,
        "NPK_TOTAL_KG_PER_HA":           80.0,
        "RAINFALL_DEV_PCT":              -5.0,
        "HEAT_STRESS":                   0.5,
        "FERT_IRR_INTERACTION":          32.0,
        "N_SHARE":                       0.6,
        "ANNUAL RAINFALL (Millimeters)": 1100.0,
        "KHARIF_RAIN_MM":                800.0,
        "RABI_RAIN_MM":                  300.0,
        "KHARIF_TMAX":                   33.0,
        "KHARIF_TMIN":                   25.0,
        "RABI_TMAX":                     27.0,
        "RABI_TMIN":                     11.0,
        "ANNUAL_TMAX":                   31.0,
        "ANNUAL_TMIN":                   20.0,
        "DIURNAL_TEMP_RANGE":            11.0,
    })
    return row


@pytest.fixture(scope="session")
def small_errors():
    return [0.1, -0.2, 0.15, -0.1, 0.05, -0.05, 0.12, -0.08]


@pytest.fixture(scope="session")
def large_errors():
    return [500.0] * 25


@pytest.fixture(scope="session")
def random_errors():
    import numpy as np
    rng = np.random.default_rng(42)
    return list(rng.normal(0, 200, 60))
