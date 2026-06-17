import logging
import os
from flask import Blueprint, jsonify, request, g, current_app
from auth.decorator import require_auth
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.output_parsers import JsonOutputParser

logger = logging.getLogger(__name__)

insights_bp = Blueprint("insights", __name__)

@insights_bp.route("/surveys/insights", methods=["POST"])
@require_auth()
def generate_insights():
    user_id = g.user_id
    company_id = g.company_id
    role = g.role

    data = request.get_json() or {}
    survey_id = data.get("survey_id")
    table_id = data.get("table_id")
    chart_type = data.get("chart_type")
    active_columns = data.get("active_columns", [])

    if not survey_id or not table_id:
        return jsonify({"error": "survey_id and table_id are required"}), 400
    
    logger.info(f"Generating insights for user {user_id} (Role: {role}) on table {table_id}")

    try:
        from services.supabase_client import get_supabase_client
        cfg = current_app.config["DASHIFY_CONFIG"]
        supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)
        
        query = (
            supabase.table("parsed_surveys").select("id, company_id, survey_data")
        ).eq("id", survey_id)
        
        if g.role != "admin":
            query = query.eq("company_id", g.company_id)
            
        result = query.limit(1).execute()
        if not result.data:
            return jsonify({"error": "survey not found or access denied"}), 404
            
        from services.parser import get_parsed_survey_data
        survey_json = get_parsed_survey_data(result.data[0], cfg)

        table_info = survey_json.get(str(table_id))
        if not table_info:
            return jsonify({"error": f"Table {table_id} not found in this survey."}), 404
            
        table_data = table_info.get("data", {})
        table_title = table_info.get("title", "Untitled Table")

        cols_to_use = active_columns if active_columns else ["Total"]
        markdown_lines = []
        header_row = f"| Response Label | " + " | ".join(cols_to_use) + " |"
        divider_row = f"|---|" + "|---|".join([""] * len(cols_to_use)) + "|"
        markdown_lines.extend([header_row, divider_row])

        for row_label, row_values in table_data.items():
            row_cells = [row_label]
            for col in cols_to_use:
                val = row_values.get(col, "-")
                if isinstance(val, (int, float)):
                    row_cells.append(f"{val:.2f}%")
                else:
                    row_cells.append(str(val))
            markdown_lines.append("| " + " | ".join(row_cells) + " |")
            
        table_markdown = "\n".join(markdown_lines)

        # Use company_id from the survey record itself to support admin users who do not have a company_id in their JWT claims
        target_company_id = result.data[0].get("company_id") or company_id

        industry = "Indian consumer market"
        company_name = "the client"
        
        if target_company_id:
            try:
                company_res = supabase.table("companies").select("name, industry").eq("id", target_company_id).limit(1).execute()
                if company_res.data:
                    company_data = company_res.data[0]
                    company_name = company_data.get("name", "the client")
                    industry = company_data.get("industry") or "Indian consumer market"
            except Exception as e:
                # Fallback if industry column does not exist yet in database
                logger.warning(f"Failed to fetch detailed company metadata, falling back to name: {e}")
                try:
                    company_res = supabase.table("companies").select("name").eq("id", target_company_id).limit(1).execute()
                    if company_res.data:
                        company_name = company_res.data[0].get("name", "the client")
                except Exception as e2:
                    logger.error(f"Failed to fetch fallback company name: {e2}")

        primary_brand = company_name

        system_prompt = (
            "You are a Senior Strategic Market Research Consultant specializing in the {industry} sector ({primary_brand} landscape). "
            "You are analyzing survey chart data for '{company_name}'.\n\n"
            "Provide exactly 3 highly actionable, market-specific insights.\n"
            "Do not simply translate or repeat the chart data (do not just state 'X is Y%'). Instead, "
            "synthesize the percentages to explain the underlying consumer psychology, socioeconomic drivers, "
            "or regional preferences unique to the Indian market.\n\n"
            "You must output your response ONLY as a valid JSON array of exactly 3 objects. Do not include any introductory text, markdown block wraps (like ```json), or conversational filler.\n"
            "IMPORTANT: Inside the JSON string values, do not use double quotes. Use single quotes if you need to quote something. Ensure all string values are strictly single-line and do not contain raw newlines. The JSON array must conform to the following schema:\n"
            "[\n"
            "  {{\n"
            '    "Topic": "Brief label of the analyzed segment/topic (e.g., North Zone, Tier 4 Cities)",\n'
            '    "Insight": "Synthesis of consumer psychology and socioeconomic drivers behind the data (1-2 sentences).",\n'
            '    "Takeaway": "Actionable recommendation for {primary_brand} product positioning or marketing (1-2 sentences).",\n'
            '    "Data Reference": "Specific supporting percentages/bases cited from the data."\n'
            "  }}\n"
            "]"
        )

        system_prompt_formatted = system_prompt.format(
            industry=industry,
            primary_brand=primary_brand,
            company_name=company_name
        )

        logger.info(f"Formatted System Prompt:\n{system_prompt_formatted}")

        messages = [
            SystemMessage(content=system_prompt_formatted),
            HumanMessage(content=f"Here is the chart data:\n{table_markdown}")
        ]

        api_key = os.environ.get("NVIDIA_API_KEY", "")
        if not api_key:
            logger.warning("NVIDIA_API_KEY is not set in environment variables.")

        model = ChatOpenAI(
            model="meta/llama-3.1-8b-instruct",
            openai_api_base="https://integrate.api.nvidia.com/v1",
            openai_api_key=api_key,
            temperature=0.2,
            max_tokens=600
        )

        chain = model | JsonOutputParser()
        insights_array = chain.invoke(messages)

        return jsonify({"insight": insights_array}), 200

    except Exception as e:
        logger.exception("Error generating insights")
        return jsonify({"error": "Failed to generate insights: " + str(e)}), 500