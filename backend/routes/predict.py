from flask import Blueprint, request, jsonify
from services.model_service import predict
from config import SUPPORTED_CROPS

predict_bp = Blueprint("predict", __name__)


@predict_bp.route("/api/predict", methods=["POST"])
def predict_yield():
    data = request.get_json()

    crop = data.get("crop", "").lower()
    if crop not in SUPPORTED_CROPS:
        return jsonify({"error": f"Unsupported crop. Choose from: {SUPPORTED_CROPS}"}), 400

    features = data.get("features", {})
    if not features:
        return jsonify({"error": "No features provided"}), 400

    try:
        result = predict(crop, features)
        return jsonify({"crop": crop, "predicted_yield": round(result, 1)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
