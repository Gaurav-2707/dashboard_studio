"""
Dashify Flask API — Application Factory
"""

import logging
from dotenv import load_dotenv

# Load environment variables from .env file (if present)
load_dotenv(override=True)

import os
from logging.handlers import RotatingFileHandler
# Configure file logging
log_path = os.path.join(os.path.dirname(__file__), "error.log")
file_handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8")
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
))
file_handler.setLevel(logging.INFO)

# Add handler to root logger
root_logger = logging.getLogger()
root_logger.addHandler(file_handler)
root_logger.setLevel(logging.INFO)

from flask import Flask, jsonify
from flask_cors import CORS

from config import Config


def create_app(config: Config | None = None) -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)

    # Load config
    cfg = config or Config()
    missing = cfg.validate()
    if missing:
        logging.warning(f"Missing required environment variables: {', '.join(missing)}")

    app.config["MAX_CONTENT_LENGTH"] = cfg.MAX_CONTENT_LENGTH
    app.config["DASHIFY_CONFIG"] = cfg

    # CORS — only allow the frontend origin
    CORS(
        app,
        origins=cfg.ALLOWED_ORIGINS,
        allow_headers=["Authorization", "Content-Type"],
        methods=["GET", "POST", "DELETE", "OPTIONS"],
        max_age=3600,
    )

    # Register blueprints
    from routes.upload import upload_bp
    from routes.aggregate import aggregate_bp
    from routes.companies import companies_bp
    from routes.insights import insights_bp

    app.register_blueprint(upload_bp, url_prefix="/api")
    app.register_blueprint(aggregate_bp, url_prefix="/api")
    app.register_blueprint(companies_bp, url_prefix="/api")
    app.register_blueprint(insights_bp, url_prefix="/api")

    # Health check
    @app.route("/api/health", methods=["GET"])
    def health():
        cfg = app.config.get("DASHIFY_CONFIG")
        secret = cfg.SUPABASE_JWT_SECRET if cfg else ""
        secret_info = {
            "loaded": bool(secret),
            "length": len(secret),
            "prefix": secret[:6] if secret else "",
            "suffix": secret[-6:] if secret else "",
        }
        return jsonify({
            "status": "ok",
            "service": "dashify-api",
            "jwt_secret": secret_info
        }), 200

    # Global error handlers
    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": str(e.description)}), 400

    @app.errorhandler(401)
    def unauthorized(e):
        return jsonify({"error": "Unauthorized"}), 401

    @app.errorhandler(403)
    def forbidden(e):
        return jsonify({"error": "Forbidden"}), 403

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(413)
    def payload_too_large(e):
        return jsonify({"error": "File too large. Maximum size is 50MB."}), 413

    @app.errorhandler(500)
    def internal_error(e):
        logging.exception("Internal server error")
        return jsonify({"error": "Internal server error"}), 500

    return app


# Entry point for production (gunicorn) and development
if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
