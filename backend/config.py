import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

SUPPORTED_CROPS = [
    "rice", "wheat", "maize", "sorghum", "pearl_millet",
    "chickpea", "pigeonpea", "groundnut", "cotton", "sugarcane"
]