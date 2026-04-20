from flask import Flask
from flask_cors import CORS
from routes.predict  import predict_bp
from routes.recommend import recommend_bp
from routes.crops    import crops_bp
from routes.health   import health_bp
from routes.history  import history_bp
from routes.settings import settings_bp
from routes.yield_reports import yield_reports_bp

def create_app():
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(predict_bp)
    app.register_blueprint(recommend_bp)
    app.register_blueprint(crops_bp)
    app.register_blueprint(health_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(yield_reports_bp)
    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, port=5000)