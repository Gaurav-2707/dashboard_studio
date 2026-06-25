import pytest
from unittest.mock import MagicMock, patch
from flask import Flask
import jwt
import time
from auth.decorator import require_auth
from config import Config
from routes.companies import companies_bp

TEST_SECRET = "test-jwt-secret-for-unit-tests-only"

def make_test_app():
    app = Flask(__name__)
    cfg = Config.__new__(Config)
    object.__setattr__(cfg, "SUPABASE_JWT_SECRET", TEST_SECRET)
    object.__setattr__(cfg, "SUPABASE_URL", "https://test.supabase.co")
    object.__setattr__(cfg, "SUPABASE_SERVICE_ROLE_KEY", "test-key")
    object.__setattr__(cfg, "ALLOWED_ORIGINS", ["http://localhost:3000"])
    object.__setattr__(cfg, "MAX_CONTENT_LENGTH", 50 * 1024 * 1024)
    app.config["DASHIFY_CONFIG"] = cfg
    app.register_blueprint(companies_bp, url_prefix="/api")
    return app

def make_token(claims: dict, secret: str = TEST_SECRET) -> str:
    default_claims = {
        "sub": "caller-123",
        "company_id": "company-456",
        "user_role": "client_admin",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    default_claims.update(claims)
    return jwt.encode(default_claims, secret, algorithm="HS256")

class TestResetUserPassword:
    @pytest.fixture
    def client(self):
        app = make_test_app()
        return app.test_client()

    @patch("routes.companies.get_supabase_client")
    def test_client_admin_resets_analyst_same_company(self, mock_get_supabase, client):
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase

        mock_profile_query = MagicMock()
        mock_profile_query.execute.return_value = MagicMock(data=[{"company_id": "company-456", "role": "analyst"}])
        mock_supabase.table.return_value.select.return_value.eq.return_value = mock_profile_query

        mock_supabase.auth.admin.update_user_by_id = MagicMock()

        token = make_token({"user_role": "client_admin", "company_id": "company-456"})
        resp = client.post(
            "/api/companies/users/reset-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"user_id": "target-user-123", "password": "new-secure-password"}
        )

        assert resp.status_code == 200
        assert resp.get_json()["success"] is True
        mock_supabase.auth.admin.update_user_by_id.assert_called_once()

    @patch("routes.companies.get_supabase_client")
    def test_client_admin_cannot_reset_different_company(self, mock_get_supabase, client):
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase

        mock_profile_query = MagicMock()
        mock_profile_query.execute.return_value = MagicMock(data=[{"company_id": "company-999", "role": "analyst"}])
        mock_supabase.table.return_value.select.return_value.eq.return_value = mock_profile_query

        token = make_token({"user_role": "client_admin", "company_id": "company-456"})
        resp = client.post(
            "/api/companies/users/reset-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"user_id": "target-user-123", "password": "new-secure-password"}
        )

        assert resp.status_code == 403
        assert "different company" in resp.get_json()["error"]

    @patch("routes.companies.get_supabase_client")
    def test_client_admin_cannot_reset_admin_roles(self, mock_get_supabase, client):
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase

        mock_profile_query = MagicMock()
        mock_profile_query.execute.return_value = MagicMock(data=[{"company_id": "company-456", "role": "client_admin"}])
        mock_supabase.table.return_value.select.return_value.eq.return_value = mock_profile_query

        token = make_token({"user_role": "client_admin", "company_id": "company-456"})
        resp = client.post(
            "/api/companies/users/reset-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"user_id": "target-user-123", "password": "new-secure-password"}
        )

        assert resp.status_code == 403
        assert "only reset analyst passwords" in resp.get_json()["error"]

    @patch("routes.companies.get_supabase_client")
    def test_global_admin_can_reset_any_role_and_company(self, mock_get_supabase, client):
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase

        mock_profile_query = MagicMock()
        mock_profile_query.execute.return_value = MagicMock(data=[{"company_id": "company-999", "role": "client_admin"}])
        mock_supabase.table.return_value.select.return_value.eq.return_value = mock_profile_query

        mock_supabase.auth.admin.update_user_by_id = MagicMock()

        token = make_token({"user_role": "admin", "company_id": None})
        resp = client.post(
            "/api/companies/users/reset-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"user_id": "target-user-123", "password": "new-secure-password"}
        )

        assert resp.status_code == 200
        assert resp.get_json()["success"] is True
        mock_supabase.auth.admin.update_user_by_id.assert_called_once()

    def test_unauthorized_role_cannot_access(self, client):
        token = make_token({"user_role": "analyst"})
        resp = client.post(
            "/api/companies/users/reset-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"user_id": "target-user-123", "password": "new-secure-password"}
        )
        assert resp.status_code == 403

    def test_validation_checks(self, client):
        token = make_token({"user_role": "admin", "company_id": None})
        
        # Missing payload
        resp = client.post(
            "/api/companies/users/reset-password",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 400

        # Short password
        resp = client.post(
            "/api/companies/users/reset-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"user_id": "target-user-123", "password": "short"}
        )
        assert resp.status_code == 400
        assert "at least 6 characters" in resp.get_json()["error"]
