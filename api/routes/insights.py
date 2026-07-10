import logging
import os
from flask import Blueprint, jsonify, request, g, current_app
from auth.decorator import require_auth
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_core.output_parsers import JsonOutputParser
from services.search_service import search_market_context

logger = logging.getLogger(__name__)

insights_bp = Blueprint("insights", __name__)

def _generate_search_query(model, brand: str, industry: str, table_title: str, active_columns: list, table_markdown: str, survey_context: str = "") -> str:
    """
    Use ChatOpenAI to generate a search-engine-optimized query based on the brand,
    industry, specific question/table title, active columns, and survey data.
    """
    cols_str = ", ".join(active_columns) if active_columns else "Total"
    instruction = (
        "You are a search query generator helper.\n"
        "Your task is to generate a highly optimized search engine query to find relevant external context (news, competitor moves, industry trends) for a survey table.\n\n"
        "Here is the survey metadata:\n"
        f"Table Title: '{table_title}'\n"
        f"Brand/Company: '{brand}'\n"
        f"Industry: '{industry}'\n"
        f"Analyzed Segments: '{cols_str}'\n"
    )
    if survey_context:
        instruction += f"Survey Context / Research Goal: '{survey_context}'\n"
    instruction += (
        "\nRules for generating the query:\n"
        "1. KEYWORDS ONLY: Output only a clean list of search keywords. Never output a sentence, conversational phrase, or descriptive description. Do not include periods or punctuation.\n"
        "2. CONCISE: Keep the query strictly between 4 and 7 words. Long queries perform poorly.\n"
        "3. NO RUN-ON MASHUPS: Focus on the brand name, the primary topic/product, and the country (e.g. 'India'). Do not try to concatenate demographic details, segments, or survey metadata into a single run-on query.\n"
        "4. ALIGNED WITH GOALS: Use the 'Survey Context / Research Goal' to guide which aspect to search for (e.g. if the context mentions 'competitor EVs', search for competitor EV launches, not general brand history).\n"
        "5. NO SURVEY LABELS: Never include code names or survey-specific column labels (like 'C1', 'C6', etc.) in the query.\n"
        "6. ONLY THE QUERY: Output ONLY the final plain text search query. Do not include quotes, markdown formatting, prefix text, or conversational filler.\n"
        "\nGood Examples:\n"
        "- 'Maruti Suzuki EV launches India'\n"
        "- 'two wheeler to car transition India'\n"
        "- 'automotive entry level car trends India'\n"
        "\nBad Examples:\n"
        "- 'Indian lower middle class 2 wheeler owners buying Maruti car market trends competitor analysis.'\n"
        "- 'Find the latest news on Maruti Suzuki EV plans and what Tata is doing'\n"
    )
    try:
        messages = [HumanMessage(content=instruction)]
        response = model.invoke(messages)
        query = response.content.strip().strip('"').strip("'").strip()
        logger.info(f"Generated dynamic search query: '{query}'")
        return query
    except Exception as e:
        logger.warning(f"Failed to generate dynamic search query: {e}")
        # Return a sensible fallback query
        return f"{brand} {table_title} India market trends"

@insights_bp.route("/surveys/insights", methods=["POST"])
@require_auth(allowed_roles=["super_admin", "admin", "client_admin", "analyst"])
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
        
        if g.role != "admin" and g.role != "super_admin":
            query = query.eq("company_id", g.company_id)
            
        result = query.limit(1).execute()
        if not result.data:
            return jsonify({"error": "survey not found or access denied"}), 404

        # Fetch admin-entered context if any
        admin_context = ""
        try:
            context_res = supabase.table("survey_contexts").select("context").eq("survey_id", survey_id).limit(1).execute()
            if context_res.data:
                admin_context = context_res.data[0].get("context", "").strip()
        except Exception as ce:
            logger.warning(f"Failed to fetch survey context: {ce}")

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
                cached_insights = cache_res.data[0]["insights"]
                has_bad_reference = False
                if isinstance(cached_insights, list):
                    for item in cached_insights:
                        ref = item.get("Data Reference", "")
                        if "not shown" in str(ref).lower() or "other charts" in str(ref).lower():
                            has_bad_reference = True
                            break
                if not has_bad_reference:
                    logger.info(f"Insights cache hit for survey {survey_id}, table {table_id}, columns: {cols_hash}")
                    return jsonify({"insight": cached_insights}), 200
                else:
                    logger.info(f"Insights cache hit but bypassed because it contains 'not shown' references: {cols_hash}")
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

        # Initialize LLM model first to allow query generation
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

        primary_brand = company_name

        # Generate search query dynamically and fetch context
        dynamic_query = _generate_search_query(model, primary_brand, industry, table_title, cols_to_use, table_markdown, admin_context)
        
        # Dual Tavily Search: Web/General + News/Articles (last 30 days)
        general_context = search_market_context(dynamic_query, topic="general")
        news_context = search_market_context(dynamic_query, topic="news", time_range="month")

        system_prompt = (
            "You are a Senior Strategic Market Research Consultant specializing in the {industry} sector ({primary_brand} landscape). "
            "You are analyzing survey chart data on the question '{table_title}' for '{company_name}'.\n\n"
            "Provide exactly 3 different, highly actionable, strategically deep, and market-specific insights. To ensure maximum strategic value, follow these rules:\n"
            "1. Segment Comparison: Compare and contrast the different columns/segments that are explicitly present in the provided chart table data. If specific demographics (like age groups, regions, zones) are not in the provided table, do not reference or invent them. Only compare segments that are explicitly visible in the table.\n"
            "2. Competitive Positioning: If other brands are present in the columns or rows of the provided table, analyze '{primary_brand}' relative strengths, weaknesses, opportunities, or threats against those competitors.\n"
            "3. Deep Synthesis: Do not simply repeat or translate percentages (do not just state 'X is Y%'). Instead, synthesize the visible data points to explain the underlying consumer psychology, cultural nuances, or socioeconomic drivers unique to the market.\n"
            "4. Actionable Takeaway: Each takeaway must be a concrete, tactical recommendation for {primary_brand} regarding product positioning, marketing messaging, or distribution strategy.\n"
            "5. Real-Time Relevance: Synthesize any provided current market news context with the survey chart data to make the takeaways highly relevant to the brand's current market position.\n"
            "6. Strict Visible Data Constraint: Analyze ONLY the provided chart data. Never invent, assume, or reference any external survey data, other charts, or unseen columns/percentages. If a data point or segment is not in the table, it does not exist for this analysis. Never output 'Data not shown' or 'analysis of other charts' — every single insight and takeaway must be backed directly by the visible numbers. All supporting numbers in 'Data Reference' must come strictly from the provided table.\n"
            "7. Strict Label Adherence: Never assume or guess the meaning of abstract codes or labels (such as 'C1', 'C2', 'C6', 'S1', etc.). Refer to them strictly by their exact name in the data (e.g., 'Group C1', 'Segment C6'). Do not assign geographic regions (like North or South Zone), age groups, or other meanings to these labels unless they are explicitly named so in the data.\n"
            "You must output your response ONLY as a valid JSON array of exactly 3 objects. Do not include any introductory text, markdown block wraps (like ```json), or conversational filler.\n"
            "IMPORTANT: Inside the JSON string values, do not use double quotes. Use single quotes if you need to quote something. Ensure all string values are strictly single-line and do not contain raw newlines. The JSON array must conform to the following schema:\n"
            "[\n"
            "  {{\n"
            '    "Topic": "Brief label of the analyzed segment/topic(all topic names should be different) (3-4 words)",\n'
            '    "Insight": "Synthesis of consumer psychology, segment variances, and competitive dynamics behind the data (1-2 sentences).",\n'
            '    "Takeaway": "Actionable strategic recommendation (SWOT/positioning) for {primary_brand} (1-2 sentences).",\n'
            '    "Data Reference": "Specific supporting percentages/bases cited from the data."\n'
            "  }}\n"
            "]"
        )

        system_prompt_formatted = system_prompt.format(
            industry=industry,
            primary_brand=primary_brand,
            company_name=company_name,
            table_title=table_title
        )

        logger.info(f"Tavily Search Query: '{dynamic_query}'")
        logger.info(f"Tavily General Web Results:\n{general_context}")
        logger.info(f"Tavily Recent News Results:\n{news_context}")

        admin_context_str = f"Additional Context for this Survey (from Admin):\n{admin_context}\n\n" if admin_context else ""
        
        context_str = ""
        if general_context:
            context_str += f"Current Market Context (Web Search):\n{general_context}\n\n"
        if news_context:
            context_str += f"Recent News & Articles (Last 30 Days):\n{news_context}\n\n"

        messages = [
            SystemMessage(content=system_prompt_formatted),
            HumanMessage(content=f"{admin_context_str}{context_str}Here is the chart data:\n{table_markdown}")
        ]



        # Invoke the model directly without tools
        response = model.invoke(messages)
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
        return jsonify({"error": "Failed to generate insights. Please try again."}), 500


@insights_bp.route("/surveys/<survey_id>/context", methods=["GET"])
@require_auth(allowed_roles=["super_admin", "admin", "client_admin", "analyst"])
def get_survey_context(survey_id):
    try:
        from services.supabase_client import get_supabase_client
        cfg = current_app.config["DASHIFY_CONFIG"]
        supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

        # Verify survey access
        survey_query = supabase.table("parsed_surveys").select("id, company_id").eq("id", survey_id)
        if g.role != "admin" and g.role != "super_admin":
            survey_query = survey_query.eq("company_id", g.company_id)
        
        survey_res = survey_query.limit(1).execute()
        if not survey_res.data:
            return jsonify({"error": "Survey not found or access denied"}), 404

        # Fetch context
        context_res = supabase.table("survey_contexts").select("context").eq("survey_id", survey_id).limit(1).execute()
        
        context_text = ""
        if context_res.data:
            context_text = context_res.data[0].get("context", "")

        return jsonify({"context": context_text}), 200
    except Exception as e:
        logger.exception("Error getting survey context")
        return jsonify({"error": "An internal error occurred."}), 500


@insights_bp.route("/surveys/<survey_id>/context", methods=["POST"])
@require_auth(allowed_roles=["super_admin", "admin"])
def save_survey_context(survey_id):
    data = request.get_json() or {}
    context_text = data.get("context", "").strip()

    try:
        from services.supabase_client import get_supabase_client
        cfg = current_app.config["DASHIFY_CONFIG"]
        supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)

        # Verify survey exists
        survey_res = supabase.table("parsed_surveys").select("id").eq("id", survey_id).limit(1).execute()
        if not survey_res.data:
            return jsonify({"error": "Survey not found"}), 404

        # Upsert context
        import datetime
        supabase.table("survey_contexts").upsert({
            "survey_id": survey_id,
            "context": context_text,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }).execute()

        # Clear cached insights for this survey because context has changed
        try:
            supabase.table("insights_cache").delete().eq("survey_id", survey_id).execute()
            logger.info(f"Cleared insights cache for survey {survey_id} due to context update.")
        except Exception as ce:
            logger.warning(f"Failed to clear insights cache for survey {survey_id}: {ce}")

        return jsonify({"success": True}), 200
    except Exception as e:
        logger.exception("Error saving survey context")
        return jsonify({"error": "An internal error occurred."}), 500


@insights_bp.route("/surveys/chat", methods=["POST"])
@require_auth(allowed_roles=["super_admin", "admin"])
def chat_with_survey_data():
    user_id = g.user_id
    company_id = g.company_id
    role = g.role

    data = request.get_json() or {}
    survey_id = data.get("survey_id")
    table_id = data.get("table_id")
    active_columns = data.get("active_columns", [])
    table_data = data.get("table_data", {})
    table_title = data.get("table_title", "Untitled Table")
    chat_messages = data.get("messages", [])

    if not survey_id or not table_id:
        return jsonify({"error": "survey_id and table_id are required"}), 400

    logger.info(f"Chat request for user {user_id} (Role: {role}) on table {table_id}")

    try:
        from services.supabase_client import get_supabase_client
        cfg = current_app.config["DASHIFY_CONFIG"]
        supabase = get_supabase_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)
        
        # Verify survey access
        query = (
            supabase.table("parsed_surveys").select("id, company_id")
        ).eq("id", survey_id)
        
        if g.role != "admin" and g.role != "super_admin":
            query = query.eq("company_id", g.company_id)
            
        result = query.limit(1).execute()
        if not result.data:
            return jsonify({"error": "survey not found or access denied"}), 404

        target_company_id = result.data[0].get("company_id") or company_id

        # Fetch company info
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
                logger.warning(f"Failed to fetch detailed company metadata: {e}")
                try:
                    company_res = supabase.table("companies").select("name").eq("id", target_company_id).limit(1).execute()
                    if company_res.data:
                        company_name = company_res.data[0].get("name", "the client")
                except Exception as e2:
                    logger.error(f"Failed to fetch fallback company name: {e2}")

        # Fetch survey context if any
        admin_context = ""
        try:
            context_res = supabase.table("survey_contexts").select("context").eq("survey_id", survey_id).limit(1).execute()
            if context_res.data:
                admin_context = context_res.data[0].get("context", "").strip()
        except Exception as ce:
            logger.warning(f"Failed to fetch survey context: {ce}")

        # Construct markdown table representation
        cols_to_use = active_columns if active_columns else ["Total"]
        markdown_lines = []
        header_row = f"| Response Label | " + " | ".join(cols_to_use) + " |"
        divider_row = f"|---|" + "|---|".join([""] * len(cols_to_use)) + "|"
        markdown_lines.extend([header_row, divider_row])

        # Table data in format: Record<string, Record<string, number | string>>
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

        api_key = os.environ.get("NVIDIA_API_KEY", "")
        model = ChatOpenAI(
            model="meta/llama-3.1-8b-instruct",
            openai_api_base="https://integrate.api.nvidia.com/v1",
            openai_api_key=api_key,
            temperature=0.3,
            max_tokens=800
        )

        system_prompt = (
            "You are a Senior Strategic Market Research Consultant specializing in the {industry} sector ({primary_brand} landscape). "
            "You are helping the user analyze survey chart data for '{company_name}' on the question '{table_title}'.\n\n"
            "Here is the chart data:\n"
            "{table_markdown}\n\n"
        )
        
        if admin_context:
            system_prompt += f"Additional Context for this Survey (from Admin):\n{admin_context}\n\n"

        system_prompt += (
            "Please answer the user's questions about this chart data under the following constraints:\n"
            "1. Grounding: Answer questions strictly based on the provided table data. Do not make up demographic segments, rows, columns, or percentages that are not shown in the table.\n"
            "2. Segmentation: Refer to demographic groups or segments (such as age, gender, regions) only if they are present in the table. Compare visible segments when relevant to the user's question.\n"
            "3. Naming: Always refer to rows and columns exactly as they are named in the data.\n"
            "4. Tone and formatting: Keep answers concise, highly professional, strategically insightful, and structured using clean conversational markdown (use bold text for key points and bullet points for lists).\n"
            "5. Limitations: If the user asks for details that are not in this table and cannot be found in the provided context, politely inform them that the data is not present in this chart.\n"
            "6. Strict History Adherence: Respond directly to the user's latest query, utilizing the provided conversation history for context."
        )

        system_prompt_formatted = system_prompt.format(
            industry=industry,
            primary_brand=company_name,
            company_name=company_name,
            table_title=table_title,
            table_markdown=table_markdown
        )

        messages = [SystemMessage(content=system_prompt_formatted)]
        for msg in chat_messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))

        # We will stream the response back using Response and event-stream
        from flask import Response
        
        def generate():
            try:
                for chunk in model.stream(messages):
                    yield chunk.content
            except Exception as stream_err:
                logger.error(f"Error during streaming: {stream_err}")
                yield f"\n[Error during generation: {stream_err}]"

        return Response(generate(), mimetype="text/event-stream")

    except Exception as e:
        logger.exception("Error in survey chat endpoint")
        return jsonify({"error": "Failed to initiate chat. Please try again."}), 500