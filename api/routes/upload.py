"""
Dashify — Upload Endpoint
POST /api/upload

Accepts an Excel file upload, parses it in-memory, computes a SHA-256
hash for deduplication, and stores the structured JSONB in parsed_surveys.
"""

import logging

from flask import Blueprint, current_app, g, jsonify, request
from services.supabase_client import get_supabase_client

from auth.decorator import require_auth
from services.parser import compute_file_hash, parse_excel_to_json

logger = logging.getLogger(__name__)

upload_bp = Blueprint("upload", __name__)


@upload_bp.route("/upload", methods=["POST"])
@require_auth(allowed_roles=["super_admin", "admin", "client_admin", "analyst"])
def upload_survey():
    """
    Upload and parse an Excel survey workbook.

    Expects: Either JSON payload with 'file_path' or multipart/form-data with 'file'.
    Returns: { survey_id, filename, table_count, is_duplicate }
    """
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    # --- 1. Check if request is JSON (Supabase Storage upload) ---
    if request.is_json:
        data = request.get_json()
        file_path = data.get("file_path")
        if not file_path:
            return jsonify({"error": "No file_path provided in JSON payload."}), 400

        # Resolve target company_id
        target_company_id = g.company_id
        if g.role in ("admin", "super_admin"):
            target_company_id = data.get("company_id") or target_company_id
            if not target_company_id:
                return jsonify({"error": "company_id is required for admin uploads"}), 400

        import os
        original_filename = os.path.basename(file_path)
        if not original_filename.lower().endswith((".xlsx", ".xlsm")):
            return jsonify({"error": "Only .xlsx and .xlsm files are supported."}), 400

        filename, _ = os.path.splitext(original_filename)
        custom_filename = data.get("filename")
        if custom_filename and custom_filename.strip():
            filename = custom_filename.strip()

        # Download file bytes from Supabase Storage using service role client
        try:
            file_bytes = supabase.storage.from_("surveys").download(file_path)
        except Exception as e:
            logger.exception(f"Failed to download file {file_path} from Supabase Storage")
            return jsonify({"error": f"Failed to retrieve file from storage: {str(e)}"}), 400

    else:
        # --- 2. Fallback to existing multipart/form-data logic ---
        if "file" not in request.files:
            return jsonify({"error": "No file provided. Use 'file' form field."}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "Empty filename"}), 400

        original_filename = file.filename
        if not original_filename.lower().endswith((".xlsx", ".xlsm")):
            return jsonify({"error": "Only .xlsx and .xlsm files are supported."}), 400

        import os
        filename, _ = os.path.splitext(original_filename)
        
        custom_filename = request.form.get("filename")
        if custom_filename and custom_filename.strip():
            filename = custom_filename.strip()

        file_bytes = file.read()

        # Resolve target company_id
        target_company_id = g.company_id
        if g.role in ("admin", "super_admin"):
            target_company_id = request.form.get("company_id")
            if not target_company_id:
                return jsonify({"error": "company_id is required for admin uploads"}), 400

    if len(file_bytes) == 0:
        return jsonify({"error": "Uploaded file is empty."}), 400

    # --- 3. Compute hash for deduplication ---
    file_hash = compute_file_hash(file_bytes)

    # --- 5. Check for duplicate uploads within this company ---
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    existing = (
        supabase.table("parsed_surveys")
        .select("id, filename")
        .eq("company_id", target_company_id)
        .eq("file_hash", file_hash)
        .limit(1)
        .execute()
    )

    if existing.data:
        return jsonify({
            "survey_id": existing.data[0]["id"],
            "filename": existing.data[0]["filename"],
            "is_duplicate": True,
            "message": "This file has already been uploaded.",
        }), 200

    # --- 7. Store the workbook raw as Base64 ---
    import base64
    try:
        raw_file_b64 = base64.b64encode(file_bytes).decode('utf-8')
        survey_data = {"raw_file_b64": raw_file_b64}
    except Exception as e:
        logger.exception("Unexpected error during file encoding")
        return jsonify({"error": "Failed to process the uploaded file."}), 500
    finally:
        # Destroy the file bytes from memory
        del file_bytes

    # --- 8. Insert into parsed_surveys ---
    insert_result = (
        supabase.table("parsed_surveys")
        .insert({
            "company_id": target_company_id,
            "uploaded_by": g.user_id,
            "filename": filename,
            "file_hash": file_hash,
            "survey_data": survey_data,
        })
        .execute()
    )

    if not insert_result.data:
        return jsonify({"error": "Failed to save survey."}), 500

    record = insert_result.data[0]

    # --- 9. Clean up temporary file from Supabase Storage (if JSON upload) ---
    if request.is_json and file_path:
        try:
            supabase.storage.from_("surveys").remove([file_path])
        except Exception as e:
            logger.warning(f"Failed to delete temporary storage file {file_path}: {e}")


    logger.info(
        f"Survey uploaded raw: {filename} "
        f"by user {g.user_id} in company {target_company_id}"
    )

    return jsonify({
        "survey_id": record["id"],
        "filename": filename,
        "table_count": 0,
        "is_duplicate": False,
    }), 201


@upload_bp.route("/surveys/<survey_id>", methods=["GET"])
@require_auth(allowed_roles=["super_admin", "admin", "client_admin", "analyst"])
def get_survey_parsed(survey_id):
    """
    Get the fully parsed survey data by survey_id. On-the-fly parsing.
    """
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    # Fetch the survey
    query = (
        supabase.table("parsed_surveys")
        .select("id, company_id, filename, survey_data, uploaded_at")
        .eq("id", survey_id)
    )
    if g.role != "admin" and g.role != "super_admin":
        query = query.eq("company_id", g.company_id)

    result = query.limit(1).execute()
    if not result.data:
        return jsonify({"error": "Survey not found or access denied."}), 404

    row = result.data[0]

    from services.parser import get_parsed_survey_data
    try:
        parsed_data = get_parsed_survey_data(row, cfg)
    except Exception as e:
        logger.exception("Error parsing workbook on the fly")
        return jsonify({"error": f"Error parsing workbook: {str(e)}"}), 500

    return jsonify({
        "id": row["id"],
        "filename": row["filename"],
        "uploaded_at": row["uploaded_at"],
        "survey_data": parsed_data,
    }), 200
