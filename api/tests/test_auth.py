"""
Tests for the JWT auth decorator.
"""

import time
from unittest.mock import MagicMock

import jwt
import pytest
from flask import Flask

from auth.decorator import require_auth
from config import Config


# Test JWT secret
TEST_SECRET = "test-jwt-secret-for-unit-tests-only"


def make_test_app():
    """Create a minimal Flask app for testing."""
    app = Flask(__name__)
    cfg = Config.__new__(Config)
    object.__setattr__(cfg, "SUPABASE_JWT_SECRET", TEST_SECRET)
    object.__setattr__(cfg, "SUPABASE_URL", "https://test.supabase.co")
    object.__setattr__(cfg, "SUPABASE_SERVICE_ROLE_KEY", "test-key")
    object.__setattr__(cfg, "ALLOWED_ORIGINS", ["http://localhost:3000"])
    object.__setattr__(cfg, "MAX_CONTENT_LENGTH", 50 * 1024 * 1024)
    app.config["DASHIFY_CONFIG"] = cfg

    @app.route("/protected")
    @require_auth(allowed_roles=["admin", "analyst"])
    def protected():
        from flask import g, jsonify
        return jsonify({"user_id": g.user_id, "company_id": g.company_id, "role": g.role})

    @app.route("/admin-only")
    @require_auth(allowed_roles=["admin"])
    def admin_only():
        from flask import g, jsonify
        return jsonify({"role": g.role})

    return app


def make_token(claims: dict, secret: str = TEST_SECRET) -> str:
    """Generate a test JWT."""
    default_claims = {
        "sub": "user-123",
        "company_id": "company-456",
        "user_role": "analyst",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    default_claims.update(claims)
    return jwt.encode(default_claims, secret, algorithm="HS256")


class TestRequireAuth:
    @pytest.fixture
    def client(self):
        app = make_test_app()
        return app.test_client()

    def test_valid_token(self, client):
        token = make_token({})
        resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["user_id"] == "user-123"
        assert data["company_id"] == "company-456"

    def test_missing_auth_header(self, client):
        resp = client.get("/protected")
        assert resp.status_code == 401

    def test_malformed_auth_header(self, client):
        resp = client.get("/protected", headers={"Authorization": "Basic abc"})
        assert resp.status_code == 401

    def test_expired_token(self, client):
        token = make_token({"exp": int(time.time()) - 100})
        resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    def test_wrong_secret(self, client):
        token = make_token({}, secret="wrong-secret")
        resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    def test_missing_company_id(self, client):
        token = make_token({"company_id": None})
        resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_unassigned_role(self, client):
        token = make_token({"user_role": "unassigned"})
        resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_insufficient_role(self, client):
        token = make_token({"user_role": "analyst"})
        resp = client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_admin_role_passes_admin_route(self, client):
        token = make_token({"user_role": "admin"})
        resp = client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.get_json()["role"] == "admin"

    def test_global_admin_bypasses_company_id_and_role_checks(self, client):
        token = make_token({"user_role": "admin", "company_id": None})
        resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["user_id"] == "user-123"
        assert data["company_id"] is None
        assert data["role"] == "admin"

    def test_global_admin_passes_admin_only_route(self, client):
        token = make_token({"user_role": "admin", "company_id": None})
        resp = client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.get_json()["role"] == "admin"
