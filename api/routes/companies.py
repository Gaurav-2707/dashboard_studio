"""
Dashify — Companies Endpoint
POST /api/companies — Admin-only company creation with agency seeding.
GET  /api/companies — List companies (admin-only).
"""

import base64
import logging

from flask import Blueprint, current_app, g, jsonify, request
from services.supabase_client import get_supabase_client

from auth.decorator import require_auth

logger = logging.getLogger(__name__)

def encrypt_password(plain_password: str, secret: str) -> str:
    """Encrypt password using XOR with JWT Secret."""
    secret_bytes = secret.encode('utf-8')
    plain_bytes = plain_password.encode('utf-8')
    cipher_bytes = bytearray(p ^ secret_bytes[i % len(secret_bytes)] for i, p in enumerate(plain_bytes))
    return base64.b64encode(cipher_bytes).decode('utf-8')

def decrypt_password(cipher_b64: str, secret: str) -> str:
    """Decrypt base64-encoded encrypted password."""
    try:
        secret_bytes = secret.encode('utf-8')
        cipher_bytes = base64.b64decode(cipher_b64.encode('utf-8'))
        plain_bytes = bytearray(c ^ secret_bytes[i % len(secret_bytes)] for i, c in enumerate(cipher_bytes))
        return plain_bytes.decode('utf-8')
    except Exception:
        return None

companies_bp = Blueprint("companies", __name__)

# Default agencies to seed for every new company
DEFAULT_IGNORED_AGENCIES = ["IPSOS", "KANTAR"]


@companies_bp.route("/companies", methods=["POST"])
@require_auth(allowed_roles=["admin"])
def create_company():
    """
    Create a new company and seed default ignored agencies.

    Expects JSON:
    {
        "name": "Acme Corp",
        "ignored_agencies": ["IPSOS", "KANTAR"]  // optional override
    }

    Returns: { company_id, name, ignored_agencies }
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

    # Optional: override default agencies
    agencies = payload.get("ignored_agencies", DEFAULT_IGNORED_AGENCIES)
    if not isinstance(agencies, list):
        return jsonify({"error": "ignored_agencies must be a list of strings."}), 400

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

    # --- 3. Seed ignored agencies ---
    if agencies:
        agency_rows = [
            {"company_id": company_id, "agency_name": name.strip()}
            for name in agencies
            if name.strip()
        ]
        if agency_rows:
            supabase.table("ignored_agencies").insert(agency_rows).execute()

    logger.info(
        f"Company created: '{company_name}' (id={company_id}) "
        f"with {len(agencies)} ignored agencies by admin {g.user_id}"
    )

    return jsonify({
        "company_id": company_id,
        "name": company_name,
        "industry": industry,
        "ignored_agencies": agencies,
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
@require_auth(allowed_roles=["admin"])
def create_user():
    """
    Create a new user with the 'analyst' role. Admin-only.
    Expects JSON:
    {
        "email": "analyst@company.com",
        "password": "securepassword",
        "company_id": "uuid"  // optional for tenant admin, required for global admin
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

    # Determine company_id
    company_id = g.company_id
    if not company_id or company_id == "null":
        company_id = payload.get("company_id")

    if not company_id:
        return jsonify({"error": "company_id is required."}), 400

    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # Encrypt password to store in user_metadata
        encrypted_pass = encrypt_password(password, cfg.SUPABASE_JWT_SECRET)

        # Resolve gotrue AdminUserAttributes structure across library versions
        try:
            from gotrue import AdminUserAttributes
            attributes = AdminUserAttributes(
                email=email,
                password=password,
                email_confirm=True,
                user_metadata={"encrypted_password": encrypted_pass}
            )
        except ImportError:
            try:
                from gotrue.types import AdminUserAttributes
                attributes = AdminUserAttributes(
                    email=email,
                    password=password,
                    email_confirm=True,
                    user_metadata={"encrypted_password": encrypted_pass}
                )
            except ImportError:
                attributes = {
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {"encrypted_password": encrypted_pass}
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
                    return jsonify({"error": f"User is orphaned and automatic cleanup failed: {str(delete_err)}"}), 500
            else:
                return jsonify({"error": "User with this email already exists."}), 400

        # 1. Create user in Supabase auth
        user_response = supabase.auth.admin.create_user(attributes)

        if not user_response or not user_response.user:
            return jsonify({"error": "Failed to create authentication user."}), 500

        user_id = user_response.user.id

        # 2. Create profile row with hardcoded 'analyst' role
        profile_result = supabase.table("profiles").insert({
            "id": user_id,
            "company_id": company_id,
            "role": "analyst"
        }).execute()

        if not profile_result.data:
            # Cleanup user if profile creation failed to avoid orphans
            try:
                supabase.auth.admin.delete_user(user_id)
            except Exception as cleanup_err:
                logger.error(f"Failed to cleanup created user {user_id}: {cleanup_err}")
            return jsonify({"error": "Failed to create user profile."}), 500

        logger.info(f"User {user_id} ({email}) created under company {company_id} by admin {g.user_id}")

        return jsonify({
            "id": user_id,
            "email": email,
            "company_id": company_id,
            "role": "analyst",
            "created_at": profile_result.data[0].get("created_at")
        }), 201

    except Exception as e:
        logger.exception("Error creating user")
        return jsonify({"error": str(e)}), 500



@companies_bp.route("/companies/users", methods=["GET"])
@require_auth(allowed_roles=["admin"])
def list_company_users():
    """
    List all users belonging to a company. Admin-only.
    Expects query parameter: ?company_id=uuid
    """
    company_id = g.company_id
    if not company_id or company_id == "null":
        company_id = request.args.get("company_id")

    if not company_id:
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

        # 2. Fetch all auth users to map emails and plain passwords
        auth_users = supabase.auth.admin.list_users()
        auth_user_map = {u.id: u for u in auth_users}

        # 3. Combine profiles and auth user data
        combined_users = []
        for p in profiles:
            user_id = p["id"]
            u = auth_user_map.get(user_id)
            email = u.email if u else "Unknown Email"
            
            # Decrypt plain password if stored
            plain_password = None
            if u and u.user_metadata:
                encrypted_pass = u.user_metadata.get("encrypted_password")
                if encrypted_pass:
                    plain_password = decrypt_password(encrypted_pass, cfg.SUPABASE_JWT_SECRET)

            combined_users.append({
                "id": user_id,
                "email": email,
                "role": p["role"],
                "plain_password": plain_password,
                "created_at": p["created_at"]
            })

        return jsonify(combined_users), 200

    except Exception as e:
        logger.exception("Error listing company users")
        return jsonify({"error": str(e)}), 500


@companies_bp.route("/companies/users/<user_id>", methods=["DELETE"])
@require_auth(allowed_roles=["admin"])
def delete_user(user_id):
    """
    Delete a user from the company workspace. Admin-only.
    """
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # 1. Fetch user's profile to verify company constraint
        profile_res = supabase.table("profiles").select("company_id").eq("id", user_id).execute()
        if not profile_res.data:
            return jsonify({"error": "User profile not found."}), 404

        target_company_id = profile_res.data[0]["company_id"]

        # If tenant admin, verify they belong to caller's company
        if g.company_id and g.company_id != "null":
            if str(target_company_id) != str(g.company_id):
                return jsonify({"error": "Forbidden: User belongs to a different company."}), 403

        # 2. Delete user from auth (cascades and deletes profiles row)
        supabase.auth.admin.delete_user(user_id)

        logger.info(f"User {user_id} deleted by admin {g.user_id}")
        return jsonify({"message": "User deleted successfully."}), 200

    except Exception as e:
        logger.exception("Error deleting user")
        return jsonify({"error": str(e)}), 500


@companies_bp.route("/companies/agencies", methods=["POST"])
@require_auth(allowed_roles=["admin"])
def add_agency():
    """
    Add a new agency header for the company workspace. Admin-only.
    Expects JSON:
    {
        "company_id": "uuid", // optional for tenant admin, required for global admin
        "agency_name": "agency name"
    }
    """
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload."}), 400

    agency_name = payload.get("agency_name", "").strip()
    if not agency_name:
        return jsonify({"error": "Agency name is required."}), 400

    # Determine company_id
    company_id = g.company_id
    if not company_id or company_id == "null":
        company_id = payload.get("company_id")

    if not company_id:
        return jsonify({"error": "company_id is required."}), 400

    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # Check for duplicates first
        existing = (
            supabase.table("ignored_agencies")
            .select("id")
            .eq("company_id", company_id)
            .eq("agency_name", agency_name)
            .execute()
        )
        if existing.data:
            return jsonify({"error": f"Agency '{agency_name}' is already registered."}), 409

        result = (
            supabase.table("ignored_agencies")
            .insert({
                "company_id": company_id,
                "agency_name": agency_name
            })
            .execute()
        )

        if not result.data:
            return jsonify({"error": "Failed to add agency."}), 500

        logger.info(f"Agency {result.data[0]['id']} ({agency_name}) added to company {company_id} by admin {g.user_id}")
        return jsonify(result.data[0]), 201
    except Exception as e:
        logger.exception("Error adding agency")
        return jsonify({"error": str(e)}), 500


@companies_bp.route("/companies/agencies/<agency_id>", methods=["DELETE"])
@require_auth(allowed_roles=["admin"])
def delete_agency(agency_id):
    """
    Remove a research agency. Admin-only.
    """
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    try:
        # Fetch agency to verify company constraint
        agency_res = supabase.table("ignored_agencies").select("company_id", "agency_name").eq("id", agency_id).execute()
        if not agency_res.data:
            return jsonify({"error": "Agency not found."}), 404

        target_company_id = agency_res.data[0]["company_id"]
        agency_name = agency_res.data[0]["agency_name"]

        # Verify company_id constraint for tenant admin
        if g.company_id and g.company_id != "null":
            if str(target_company_id) != str(g.company_id):
                return jsonify({"error": "Forbidden: Agency belongs to a different company."}), 403

        # Delete agency
        supabase.table("ignored_agencies").delete().eq("id", agency_id).execute()

        logger.info(f"Agency {agency_id} ({agency_name}) deleted by admin {g.user_id}")
        return jsonify({"message": "Agency deleted successfully."}), 200
    except Exception as e:
        logger.exception("Error deleting agency")
        return jsonify({"error": str(e)}), 500

