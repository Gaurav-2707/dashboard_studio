import logging
import os
import math
from flask import Blueprint, jsonify, request, g, current_app
from auth.decorator import require_auth
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

insights_bp = Blueprint("insights", __name__)

@tool
def check_significance(
    p1: float, n1: int, p2: float, n2: int, label1: str = "Group 1", label2: str = "Group 2"
) -> str:
    """
    Computes a two-proportion Z-test to see if the difference between two sample percentages is statistically significant.
    Parameters:
    - p1: Percentage of group 1 as a float (e.g. 45.5 for 45.5%).
    - n1: Base/sample size of group 1 (e.g. 250).
    - p2: Percentage of group 2 as a float (e.g. 30.0 for 30.0%).
    - n2: Base/sample size of group 2 (e.g. 210).
    - label1: Optional label for group 1.
    - label2: Optional label for group 2.
    """
    if n1 < 30 or n2 < 30:
        return f"Warning: Sample base sizes are too small (n1={n1}, n2={n2}) for a reliable significance test. Results should be treated with caution."

    
    # Convert percentages to proportions
    prop1 = p1 / 100.0
    prop2 = p2 / 100.0
    
    # Count of successes
    x1 = prop1 * n1
    x2 = prop2 * n2
    
    # Pooled proportion
    p_pool = (x1 + x2) / (n1 + n2)
    
    if p_pool <= 0 or p_pool >= 1:
        return f"Difference between {label1} ({p1}%) and {label2} ({p2}%) is NOT statistically significant (pooled proportion is boundary: {p_pool})."
        
    # Standard error
    se = math.sqrt(p_pool * (1.0 - p_pool) * (1.0 / n1 + 1.0 / n2))
    
    # Z-score
    z = (prop1 - prop2) / se
    
    # 95% confidence significance test (two-tailed critical value = 1.96)
    is_sig = abs(z) >= 1.96
    
    status = "is SIGNIFICANT" if is_sig else "is NOT significant"
    return f"Z-score: {z:.3f}. The difference between {label1} ({p1}%, n={n1}) and {label2} ({p2}%, n={n2}) {status} at 95% confidence level."

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

        # ----------------------------------------------------------------------
        # Caching Layer: Check if insights exist in cache
        # ----------------------------------------------------------------------
        cols_hash = ",".join(sorted(active_columns)) if active_columns else "Total"
        try:
            cache_res = supabase.table("insights_cache") \
                .select("insights") \
                .eq("survey_id", survey_id) \
                .eq("table_id", str(table_id)) \
                .eq("active_columns_hash", cols_hash) \
                .limit(1) \
                .execute()
            if cache_res.data:
                logger.info(f"Insights cache hit for survey {survey_id}, table {table_id}, columns: {cols_hash}")
                return jsonify({"insight": cache_res.data[0]["insights"]}), 200
        except Exception as ce:
            logger.warning(f"Failed to query insights cache: {ce}")
            
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
            "You are a Senior Strategic Market Research Consultant specializing in the Indian {industry} sector ({primary_brand} landscape). "
            "You are analyzing survey chart data for '{company_name}'.\n\n"
            "You have access to a tool called `check_significance` to check if the difference between two percentages is statistically significant at 95% confidence level. "
            "CRITICAL: You are only allowed to invoke at most one tool call per turn. Do not call this tool multiple times in parallel or make parallel tool calls. If you need to check multiple pairs, select only the single most relevant pair and make exactly one tool call.\n\n"
            "Provide EXACTLY 3 highly actionable, market-specific insights. You must analyze the data and generate exactly 3 objects. Do not stop after 1 or 2.\n"
            "Do not simply translate or repeat the chart data (do not just state 'X is Y%'). Instead, "
            "synthesize the percentages to explain the underlying consumer psychology, socioeconomic drivers, "
            "or regional preferences unique to the Indian market.\n\n"
            "You must output your response ONLY as a valid JSON array of exactly 3 objects. Do not include any introductory text, markdown block wraps (like ```json), or conversational filler.\n"
            "IMPORTANT: Inside the JSON string values, do not use double quotes. Use single quotes if you need to quote something. Ensure all string values are strictly single-line and do not contain raw newlines. The JSON array must conform to the following schema structure, representing exactly 3 distinct insights:\n"
            "[\n"
            "  {{\n"
            '    "Topic": "Brief label of the first analyzed segment/topic (e.g., North Zone, Tier 4 Cities)",\n'
            '    "Insight": "Synthesis of consumer psychology and socioeconomic drivers behind the first point (1-2 sentences).",\n'
            '    "Takeaway": "Actionable recommendation for {primary_brand} product positioning or marketing (1-2 sentences).",\n'
            '    "Data Reference": "Specific supporting percentages/bases cited from the data."\n'
            "  }},\n"
            "  {{\n"
            '    "Topic": "Brief label of the second analyzed segment/topic (e.g., South Zone, Metro Cities)",\n'
            '    "Insight": "Synthesis of consumer psychology and socioeconomic drivers behind the second point (1-2 sentences).",\n'
            '    "Takeaway": "Actionable recommendation for {primary_brand} product positioning or marketing (1-2 sentences).",\n'
            '    "Data Reference": "Specific supporting percentages/bases cited from the data."\n'
            "  }},\n"
            "  {{\n"
            '    "Topic": "Brief label of the third analyzed segment/topic (e.g., East Zone, Female Buyers)",\n'
            '    "Insight": "Synthesis of consumer psychology and socioeconomic drivers behind the third point (1-2 sentences).",\n'
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

        # Bind the statistical significance tool
        model_with_tools = model.bind_tools([check_significance])

        final_content = ""
        # Up to 5 loop iterations to allow tool calls to resolve
        for i in range(5):
            response = model_with_tools.invoke(messages)
            
            if hasattr(response, "tool_calls") and response.tool_calls:
                logger.info(f"LLM requested tool calls at iteration {i}: {response.tool_calls}")
                messages.append(response)
                
                # Execute only the first tool call to satisfy the single tool-call restriction of the NIM endpoint
                tool_call = response.tool_calls[0]
                if tool_call["name"] == "check_significance":
                    args = tool_call["args"]
                    tool_result = check_significance.invoke(args)
                    logger.info(f"Tool execution result: {tool_result}")
                    messages.append(ToolMessage(
                        content=str(tool_result),
                        tool_call_id=tool_call["id"],
                        name=tool_call["name"]
                    ))
                continue
            else:
                final_content = response.content
                break
        else:
            final_content = response.content

        parser = JsonOutputParser()
        insights_array = parser.parse(final_content)

        if isinstance(insights_array, dict):
            insights_array = [insights_array]
        elif not isinstance(insights_array, list):
            insights_array = []

        # ----------------------------------------------------------------------
        # Caching Layer: Write the new insights to cache (Upserting on conflict)
        # ----------------------------------------------------------------------
        try:
            supabase.table("insights_cache").upsert({
                "survey_id": survey_id,
                "table_id": str(table_id),
                "active_columns": active_columns,
                "active_columns_hash": cols_hash,
                "insights": insights_array
            }, on_conflict="survey_id,table_id,active_columns_hash").execute()
            logger.info(f"Insights cached successfully for survey {survey_id}, table {table_id}, columns: {cols_hash}")
        except Exception as ce:
            logger.warning(f"Failed to write to insights cache: {ce}")

        return jsonify({"insight": insights_array}), 200

    except Exception as e:
        logger.exception("Error generating insights")
        return jsonify({"error": "Failed to generate insights: " + str(e)}), 500