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
            payload = None
            last_err = None

            # Attempt Local Verification if secret is available
            if jwt_secret:
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
                except jwt.ExpiredSignatureError:
                    logger.info("JWT has expired during local verification (Base64)")
                    abort(401, description="Unauthorized")
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
                        logger.info("JWT has expired during local verification (Raw)")
                        abort(401, description="Unauthorized")
                    except Exception as e:
                        last_err = e
            else:
                last_err = Exception("SUPABASE_JWT_SECRET is not configured; local verification skipped")

            # Attempt 3: Remote verification via Supabase Auth (final fallback)
            if payload is None:
                if not cfg.SUPABASE_URL or not cfg.SUPABASE_SERVICE_ROLE_KEY:
                    logger.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing; cannot perform remote verification fallback.")
                    abort(500, description="Internal server error")

                try:
                    from services.supabase_client import get_supabase_client
                    # Initialize client with public URL and service role key
                    supabase_client = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)
                    user_resp = supabase_client.auth.get_user(token)
                    
                    if user_resp and user_resp.user:
                        user_id = user_resp.user.id
                        # Securely retrieve user role and company binding (with status check) in 1 query via join
                        profile_res = (
                            supabase_client.table("profiles")
                            .select("company_id, role, companies(status)")
                            .eq("id", user_id)
                            .single()
                            .execute()
                        )
                        if not profile_res.data:
                            logger.warning(f"No profile found for remotely verified user {user_id}")
                            abort(403, description="Forbidden")
                        
                        company_id = profile_res.data.get("company_id")
                        role = profile_res.data.get("role")
                        
                        # Validate company status if not admin
                        if role not in ("super_admin", "admin"):
                            company_data = profile_res.data.get("companies")
                            if company_data and company_data.get("status") == "pending_deletion":
                                logger.warning(f"User {user_id} belongs to suspended company {company_id}")
                                abort(403, description="Forbidden")

                        payload = {
                            "sub": user_id,
                            "company_id": company_id,
                            "user_role": role,
                        }
                    else:
                        logger.warning("Remote verification did not return a valid user")
                        abort(401, description="Unauthorized")

                except Exception as e:
                    if hasattr(e, 'code'):
                        # Propagate aborts from within try block
                        raise
                    logger.warning(f"Remote token verification failed: {e} (base64 local error: {last_err})")
                    abort(401, description="Unauthorized")

            if payload is None:
                abort(401, description="Unauthorized")

            # --- 3. Extract claims ---
            user_id = payload.get("sub")
            company_id = payload.get("company_id")
            role = payload.get("user_role")

            if not user_id:
                logger.error("Token missing user identity (sub) claim")
                abort(401, description="Unauthorized")

            if (not company_id or company_id == "null") and role not in ("super_admin", "admin"):
                logger.warning(f"User {user_id} with role '{role}' is not assigned to any company")
                abort(403, description="Forbidden")

            if not role or role == "unassigned":
                logger.warning(f"User {user_id} has no assigned role")
                abort(403, description="Forbidden")

            # --- 4. Role enforcement ---
            if allowed_roles and role not in allowed_roles and role not in ("super_admin", "admin"):
                logger.warning(
                    f"Role '{role}' not in allowed_roles {allowed_roles} "
                    f"for user {user_id}"
                )
                abort(403, description="Forbidden")

            # --- 5. Populate request context ---
            g.user_id = user_id
            g.company_id = company_id
            g.role = role
            g.jwt_payload = payload

            return fn(*args, **kwargs)

        return wrapper

    return decorator
