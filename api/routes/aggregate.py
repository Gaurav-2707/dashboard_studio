"""
Dashify — Aggregation Endpoint
POST /api/aggregate

Computes intersection columns for selected survey columns within a table.
Stateless: reads from parsed_surveys JSONB, computes, returns result.
"""

import logging

from flask import Blueprint, current_app, g, jsonify, request
from services.supabase_client import get_supabase_client

from auth.decorator import require_auth
from services.aggregator import compute_intersection

logger = logging.getLogger(__name__)

aggregate_bp = Blueprint("aggregate", __name__)


@aggregate_bp.route("/aggregate", methods=["POST"])
@require_auth(allowed_roles=["super_admin", "admin", "client_admin", "analyst"])
def aggregate():
    """
    Compute intersection aggregation for selected columns in a survey table.

    Expects JSON:
    {
        "survey_id": "uuid",
        "table_number": 1,
        "column_ids": ["Column A", "Column B"]
    }

    Returns:
    {
        "combined_column_name": "Column A & Column B",
        "is_mutually_exclusive": false,
        "combined_base_weighted": 123.4,
        "combined_base_unweighted": 120.0,
        "rows": { "Response Label": 45.6, ... }
    }
    """
    # --- 1. Validate payload ---
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload."}), 400

    survey_id = payload.get("survey_id")
    table_number = payload.get("table_number")
    column_ids = payload.get("column_ids")

    if not survey_id:
        return jsonify({"error": "survey_id is required."}), 400
    if table_number is None:
        return jsonify({"error": "table_number is required."}), 400
    if not column_ids or not isinstance(column_ids, list) or len(column_ids) == 0:
        return jsonify({"error": "column_ids must be a non-empty list of strings."}), 400

    # Sanitize table_number
    try:
        table_number = int(table_number)
    except (TypeError, ValueError):
        return jsonify({"error": "table_number must be an integer."}), 400

    # --- 2. Fetch the survey (tenant-scoped) ---
    cfg = current_app.config["DASHIFY_CONFIG"]
    supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

    # CRITICAL: Always filter by company_id from the JWT (unless admin) — never trust client input
    query = (
        supabase.table("parsed_surveys")
        .select("id, company_id, survey_data")
        .eq("id", survey_id)
    )
    if g.role != "admin" and g.role != "super_admin":
        query = query.eq("company_id", g.company_id)  # Tenant isolation

    result = query.limit(1).execute()

    if not result.data:
        return jsonify({"error": "Survey not found or access denied."}), 404

    from services.parser import get_parsed_survey_data
    survey_data = get_parsed_survey_data(result.data[0], cfg)

    # --- 3. Extract the target table ---
    table_key = str(table_number)
    if table_key not in survey_data:
        return jsonify({
            "error": f"Table {table_number} not found in this survey.",
            "available_tables": list(survey_data.keys()),
        }), 404

    table_info = survey_data[table_key]
    table_data = table_info.get("data", {})

    if not table_data:
        return jsonify({"error": f"Table {table_number} has no data."}), 404

    # --- 4. Validate that requested columns exist ---
    all_columns = set()
    for row_data in table_data.values():
        all_columns.update(row_data.keys())

    missing_cols = [c for c in column_ids if c not in all_columns]
    if missing_cols:
        return jsonify({
            "error": f"Columns not found in table: {missing_cols}",
            "available_columns": sorted(all_columns),
        }), 400

    # --- 5. Compute intersection ---
    try:
        result_data = compute_intersection(table_data, column_ids)
    except Exception as e:
        logger.exception("Error computing intersection")
        return jsonify({"error": "Aggregation computation failed."}), 500

    return jsonify({
        "survey_id": survey_id,
        "table_number": table_number,
        "table_title": table_info.get("title", "Unknown"),
        **result_data,
    }), 200
