"""
Dashify — Companies Endpoint
POST /api/companies — Admin-only company creation with agency seeding.
GET  /api/companies — List companies (admin-only).
"""

import logging

from flask import Blueprint, current_app, g, jsonify, request
from services.supabase_client import get_supabase_client

from auth.decorator import require_auth

logger = logging.getLogger(__name__)

companies_bp = Blueprint("companies", __name__)

@companies_bp.route("/companies", methods=["POST"])
@require_auth(allowed_roles=["admin"])
def create_company():
    """
    Create a new company.

    Expects JSON:
    {
        "name": "Acme Corp",
        "industry": "Automotive"
    }

    Returns: { company_id, name, industry }
    """
    payload = request.get_json(silent=True) or {}
    company_name = payload.get("name", "").strip()
    if not company_name:
        return jsonify({"error": "Company name is required."}), 400

    if len(company_name) > 200:
        return jsonify({"error": "Company name must be 200 characters or less."}), 400

    industry = payload.get("industry", "").strip() or None

    if industry and len(industry) > 200:
        return jsonify({"error": "Industry must be 200 characters or less."}), 400

    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    # --- 1. Check for duplicate name ---
    existing = (
        supabase.table("companies")
        .select("id")
        .eq("name", company_name)
        .limit(1)
        .execute()
    )
    if existing.data:
        return jsonify({"error": f"Company '{company_name}' already exists."}), 409

    # --- 2. Create company ---
    company_result = (
        supabase.table("companies")
        .insert({
            "name": company_name,
            "industry": industry
        })
        .execute()
    )

    if not company_result.data:
        return jsonify({"error": "Failed to create company."}), 500

    company_id = company_result.data[0]["id"]

    logger.info(
        f"Company created: '{company_name}' (id={company_id}) by admin {g.user_id}"
    )

    return jsonify({
        "company_id": company_id,
        "name": company_name,
        "industry": industry,
    }), 201


@companies_bp.route("/companies", methods=["GET"])
@require_auth(allowed_roles=["admin"])
def list_companies():
    """
    List all companies. Admin-only.
    Returns: { companies: [...] }
    """
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    result = (
        supabase.table("companies")
        .select("id, name, status, created_at")
        .order("created_at", desc=True)
        .execute()
    )

    return jsonify({"companies": result.data or []}), 200


@companies_bp.route("/companies/users", methods=["POST"])
@require_auth(allowed_roles=["admin", "client_admin"])
def create_user():
    """
    Create a new user. Admin and client_admin can access.
    Client admins can only create 'analyst' users in their own company.
    System admins can create users with any role.
    Expects JSON:
    {
        "email": "analyst@company.com",
        "password": "securepassword",
        "company_id": "uuid",  // optional for tenant admin, required for global admin
        "role": "analyst"      // optional, defaults to 'analyst'. Only admin can set non-analyst roles.
    }
    """
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload."}), 400

    email = payload.get("email", "").strip()
    password = payload.get("password", "")

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters long."}), 400

    # Determine target role
    requested_role = payload.get("role", "analyst").strip().lower()
    if g.role == "client_admin":
        # Client admins can only create analyst users
        if requested_role != "analyst":
            return jsonify({"error": "Client admins can only create analyst users."}), 403
        target_role = "analyst"
    else:
        # System admin can set any valid role
        if requested_role not in ("admin", "client_admin", "analyst"):
            return jsonify({"error": f"Invalid role: '{requested_role}'. Must be admin, client_admin, or analyst."}), 400
        target_role = requested_role

    # Determine company_id — non-admin roles MUST use JWT claim, never client input
    company_id = g.company_id
    if g.role == "admin":
        # Only system admins (who have no company_id) can specify one
        if not company_id or company_id == "null":
            company_id = payload.get("company_id")
    
    if not company_id or company_id == "null":
        return jsonify({"error": "company_id is required."}), 400

    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # Resolve gotrue AdminUserAttributes structure across library versions
        try:
            from gotrue import AdminUserAttributes
            attributes = AdminUserAttributes(
                email=email,
                password=password,
                email_confirm=True,
            )
        except ImportError:
            try:
                from gotrue.types import AdminUserAttributes
                attributes = AdminUserAttributes(
                    email=email,
                    password=password,
                    email_confirm=True,
                )
            except ImportError:
                attributes = {
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                }

        # Check if user already exists in auth.users
        existing_user = None
        try:
            users_list = supabase.auth.admin.list_users()
            existing_user = next((u for u in users_list if u.email.lower() == email.lower()), None)
        except Exception as list_err:
            logger.warning(f"Failed to list auth users: {list_err}")

        if existing_user:
            # Check if this user has an active profile
            profile_check = supabase.table("profiles").select("id").eq("id", existing_user.id).execute()
            if not profile_check.data:
                # User is orphaned (exists in auth but has no profile) — delete them first
                logger.info(f"Deleting orphaned auth user {existing_user.id} ({email}) before re-creation.")
                try:
                    supabase.auth.admin.delete_user(existing_user.id)
                except Exception as delete_err:
                    logger.error(f"Failed to delete orphaned user {existing_user.id}: {delete_err}")
                    return jsonify({"error": "An internal error occurred during user cleanup."}), 500
            else:
                return jsonify({"error": "User with this email already exists."}), 400

        # 1. Create user in Supabase auth
        user_response = supabase.auth.admin.create_user(attributes)

        if not user_response or not user_response.user:
            return jsonify({"error": "Failed to create authentication user."}), 500

        user_id = user_response.user.id

        # 2. Create profile row with the resolved role
        profile_result = supabase.table("profiles").insert({
            "id": user_id,
            "company_id": company_id,
            "role": target_role
        }).execute()

        if not profile_result.data:
            # Cleanup user if profile creation failed to avoid orphans
            try:
                supabase.auth.admin.delete_user(user_id)
            except Exception as cleanup_err:
                logger.error(f"Failed to cleanup created user {user_id}: {cleanup_err}")
            return jsonify({"error": "Failed to create user profile."}), 500

        logger.info(f"User {user_id} ({email}) created as '{target_role}' under company {company_id} by {g.role} {g.user_id}")

        return jsonify({
            "id": user_id,
            "email": email,
            "company_id": company_id,
            "role": target_role,
            "created_at": profile_result.data[0].get("created_at")
        }), 201

    except Exception as e:
        logger.exception("Error creating user")
        return jsonify({"error": "An internal error occurred while creating the user."}), 500



@companies_bp.route("/companies/users", methods=["GET"])
@require_auth(allowed_roles=["admin", "client_admin"])
def list_company_users():
    """
    List all users belonging to a company. Admin-only.
    Expects query parameter: ?company_id=uuid
    """
    # Non-admin roles MUST use JWT claim, never client input
    company_id = g.company_id
    if g.role == "admin":
        if not company_id or company_id == "null":
            company_id = request.args.get("company_id")

    if not company_id or company_id == "null":
        return jsonify({"error": "company_id is required."}), 400

    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # 1. Fetch profiles for this company
        profiles_res = (
            supabase.table("profiles")
            .select("id, role, created_at")
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .execute()
        )
        profiles = profiles_res.data or []

        if not profiles:
            return jsonify([]), 200

        # 2. Fetch all auth users to map emails
        auth_users = supabase.auth.admin.list_users()
        auth_user_map = {u.id: u for u in auth_users}

        # 3. Combine profiles and auth user data
        combined_users = []
        for p in profiles:
            user_id = p["id"]
            u = auth_user_map.get(user_id)
            email = u.email if u else "Unknown Email"

            combined_users.append({
                "id": user_id,
                "email": email,
                "role": p["role"],
                "created_at": p["created_at"]
            })

        return jsonify(combined_users), 200

    except Exception as e:
        logger.exception("Error listing company users")
        return jsonify({"error": "An internal error occurred while listing users."}), 500


@companies_bp.route("/companies/users/reset-password", methods=["POST"])
@require_auth(allowed_roles=["admin", "client_admin"])
def reset_user_password():
    """
    Reset a user's password. Admin and client_admin can access.
    Client admins can only reset the password of analyst users within their own company.
    """
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload."}), 400

    target_user_id = payload.get("user_id", "").strip()
    new_password = payload.get("password", "")

    if not target_user_id or not new_password:
        return jsonify({"error": "user_id and password are required."}), 400

    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters long."}), 400

    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # 1. Fetch user's profile to verify company and role constraints
        profile_res = supabase.table("profiles").select("company_id, role").eq("id", target_user_id).execute()
        if not profile_res.data:
            return jsonify({"error": "User profile not found."}), 404

        target_company_id = profile_res.data[0]["company_id"]
        target_role = profile_res.data[0]["role"]

        # If tenant admin or client_admin, verify they belong to caller's company
        if g.company_id and g.company_id != "null":
            if str(target_company_id) != str(g.company_id):
                return jsonify({"error": "Forbidden: User belongs to a different company."}), 403

        # Client admins can only reset passwords for analyst users — not other client_admins or system admins
        if g.role == "client_admin" and target_role != "analyst":
            return jsonify({"error": "Client admins can only reset analyst passwords."}), 403

        # 2. Update user's password in auth
        # Resolve gotrue AdminUserAttributes structure across library versions
        try:
            from gotrue import AdminUserAttributes
            attributes = AdminUserAttributes(password=new_password)
        except ImportError:
            try:
                from gotrue.types import AdminUserAttributes
                attributes = AdminUserAttributes(password=new_password)
            except ImportError:
                attributes = {"password": new_password}

        supabase.auth.admin.update_user_by_id(target_user_id, attributes)

        logger.info(f"Password reset for user {target_user_id} by {g.role} {g.user_id}")
        return jsonify({"success": True, "message": "Password reset successfully."}), 200

    except Exception as e:
        logger.exception("Error resetting user password")
        return jsonify({"error": "An internal error occurred while resetting the password."}), 500


@companies_bp.route("/companies/users/<user_id>", methods=["DELETE"])
@require_auth(allowed_roles=["admin", "client_admin"])
def delete_user(user_id):
    """
    Delete a user from the company workspace. Admin and client_admin can access.
    Client admins can only delete analyst users within their own company.
    """
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # 1. Fetch user's profile to verify company and role constraints
        profile_res = supabase.table("profiles").select("company_id, role").eq("id", user_id).execute()
        if not profile_res.data:
            return jsonify({"error": "User profile not found."}), 404

        target_company_id = profile_res.data[0]["company_id"]
        target_role = profile_res.data[0]["role"]

        # If tenant admin or client_admin, verify they belong to caller's company
        if g.company_id and g.company_id != "null":
            if str(target_company_id) != str(g.company_id):
                return jsonify({"error": "Forbidden: User belongs to a different company."}), 403

        # Client admins can only delete analyst users — not other client_admins or system admins
        if g.role == "client_admin" and target_role != "analyst":
            return jsonify({"error": "Client admins can only remove analyst users."}), 403

        # 2. Delete user from auth (cascades and deletes profiles row)
        supabase.auth.admin.delete_user(user_id)

        logger.info(f"User {user_id} deleted by {g.role} {g.user_id}")
        return jsonify({"message": "User deleted successfully."}), 200

    except Exception as e:
        logger.exception("Error deleting user")
        return jsonify({"error": "An internal error occurred while deleting the user."}), 500

