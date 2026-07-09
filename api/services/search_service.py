import logging
import os
import requests

logger = logging.getLogger(__name__)

def search_market_context(query: str, topic: str = "general", time_range: str = None) -> str:
    """
    Search the web for recent market trends, competitor launches, and news
    using the Tavily Search API.

    Returns:
        A formatted string listing the top titles and snippets, or an empty string
        on failure/no results/missing API key.
    """
    if not query or not query.strip():
        return ""

    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        logger.warning("TAVILY_API_KEY is not configured in environment variables. Skipping web search.")
        return ""

    logger.info(f"Executing Tavily search query: '{query}' (Topic: {topic}, Time Range: {time_range})")

    headers = {"Content-Type": "application/json"}
    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": "advanced",
        "topic": topic,
        "max_results": 3
    }
    if time_range:
        payload["time_range"] = time_range

    try:
        response = requests.post(
            "https://api.tavily.com/search",
            json=payload,
            headers=headers,
            timeout=15
        )
        if response.status_code != 200:
            logger.warning(f"Tavily API returned status code {response.status_code}: {response.text}")
            return ""

        data = response.json()
        results = data.get("results", [])
        if not results:
            logger.info("Tavily search returned no results.")
            return ""

        formatted = []
        for r in results:
            title = r.get("title", "No Title").strip()
            content = r.get("content", "").strip()
            if title and content:
                formatted.append(f"- {title}: {content}")

        return "\n".join(formatted)
    except Exception as e:
        logger.warning(f"Tavily search failed for query '{query}': {e}", exc_info=True)
        return ""
