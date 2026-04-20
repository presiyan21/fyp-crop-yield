from flask import Blueprint, jsonify
from config import SUPPORTED_CROPS

health_bp = Blueprint("health", __name__)


@health_bp.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "crops_loaded": len(SUPPORTED_CROPS),
        "model": "XGBoost (deployment)",
    })