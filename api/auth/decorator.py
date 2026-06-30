"""
Dashify — JWT Authentication Decorator
Validates Supabase access tokens and enforces role-based access control.
"""

import functools
import logging
from typing import Callable

import jwt
from flask import abort, current_app, g, request

logger = logging.getLogger(__name__)


def require_auth(allowed_roles: list[str] | None = None):
    """
    Flask route decorator that validates the Supabase JWT from the
    Authorization header and enforces role-based access.

    After successful validation, the following are available on `flask.g`:
        g.user_id      — UUID string of the authenticated user
        g.company_id   — UUID string of the user's tenant
        g.role         — 'admin', 'client_admin', or 'analyst'

    Args:
        allowed_roles: List of roles permitted to access the route.
                       If None, any authenticated user is allowed.

    Raises:
        401: Missing, invalid, or expired token.
        403: User's role is not in allowed_roles.
    """

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            # --- 1. Extract Bearer token ---
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                logger.warning("Missing or malformed Authorization header")
                abort(401, description="Missing or malformed Authorization header")

            token = auth_header[7:]  # Strip "Bearer "
            if not token:
                abort(401, description="Empty bearer token")

            # --- 2. Decode and verify JWT ---
            cfg = current_app.config.get("DASHIFY_CONFIG")
            jwt_secret = cfg.SUPABASE_JWT_SECRET if cfg else ""

            if not jwt_secret:
                logger.error("SUPABASE_JWT_SECRET is not configured")
                abort(500, description="Server misconfiguration")

            # Try decoding with base64 decoded secret first (Supabase default),
            # then fall back to the raw secret (useful for tests or custom secrets).
            payload = None
            last_err = None

            # Attempt 1: Base64 decoded secret
            import base64
            try:
                missing_padding = len(jwt_secret) % 4
                padded_secret = jwt_secret
                if missing_padding:
                    padded_secret += '=' * (4 - missing_padding)
                decoded_secret = base64.b64decode(padded_secret)
                payload = jwt.decode(
                    token,
                    decoded_secret,
                    algorithms=["HS256"],
                    options={
                        "require": ["exp", "sub"],
                        "verify_exp": True,
                        "verify_iat": True,
                    },
                )
            except jwt.ExpiredSignatureError as e:
                # If it expired, it was signed correctly but is just old
                logger.info("JWT has expired")
                abort(401, description="Token has expired")
            except Exception as e:
                last_err = e

            # Attempt 2: Raw secret (fallback)
            if payload is None:
                try:
                    payload = jwt.decode(
                        token,
                        jwt_secret,
                        algorithms=["HS256"],
                        options={
                            "require": ["exp", "sub"],
                            "verify_exp": True,
                            "verify_iat": True,
                        },
                    )
                except jwt.ExpiredSignatureError:
                    logger.info("JWT has expired")
                    abort(401, description="Token has expired")
                except Exception as e:
                    last_err = e

            # Attempt 3: Remote verification via Supabase Auth (final fallback)
            if payload is None:
                try:
                    from services.supabase_client import get_supabase_client
                    # Initialize client with public URL and service role key
                    supabase_client = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)
                    user_resp = supabase_client.auth.get_user(token)
                    if user_resp and user_resp.user:
                        # Since remote verification passed, we can safely decode claims locally without signature verification
                        payload = jwt.decode(
                            token,
                            options={"verify_signature": False},
                            algorithms=["HS256"]
                        )
                except Exception as e:
                    logger.warning(f"Remote token verification failed: {e} (base64 error: {last_err})")
                    abort(401, description="Invalid token")

            if payload is None:
                abort(401, description="Invalid token")

            # --- 3. Extract claims ---
            user_id = payload.get("sub")
            company_id = payload.get("company_id")
            role = payload.get("user_role")

            if not user_id:
                abort(401, description="Token missing user identity (sub)")

            if (not company_id or company_id == "null") and role not in ("super_admin", "admin"):
                abort(403, description="User is not assigned to any company")

            if not role or role == "unassigned":
                abort(403, description="User has no assigned role")

            # --- 4. Role enforcement ---
            if allowed_roles and role not in allowed_roles:
                logger.warning(
                    f"Role '{role}' not in allowed_roles {allowed_roles} "
                    f"for user {user_id}"
                )
                abort(403, description=f"Insufficient permissions.")

            # --- 5. Populate request context ---
            g.user_id = user_id
            g.company_id = company_id
            g.role = role
            g.jwt_payload = payload

            return fn(*args, **kwargs)

        return wrapper

    return decorator
