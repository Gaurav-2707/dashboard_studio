import pytest
from unittest.mock import patch, MagicMock
from services.search_service import search_market_context

@patch.dict("os.environ", {"TAVILY_API_KEY": "test-key-123"})
def test_search_market_context_empty_params():
    assert search_market_context("") == ""
    assert search_market_context("   ") == ""
    assert search_market_context(None) == ""

@patch.dict("os.environ", {}, clear=True)
def test_search_market_context_missing_key():
    # If API key is missing, should log warning and return empty string without failing
    assert search_market_context("Tata EV India") == ""

@patch.dict("os.environ", {"TAVILY_API_KEY": "test-key-123"})
@patch("services.search_service.requests.post")
def test_search_market_context_success(mock_post):
    # Mock Tavily API response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "results": [
            {"title": "Tata Motors EV Sales", "content": "Tata Motors electric vehicles lead the Indian market with high sales."},
            {"title": "Automotive sector India", "content": "Indian automotive industry shows significant growth in EV segment."}
        ]
    }
    mock_post.return_value = mock_response

    res = search_market_context("Tata EV India")

    assert "Tata Motors EV Sales" in res
    assert "EV segment" in res
    # Verify post arguments
    mock_post.assert_called_once_with(
        "https://api.tavily.com/search",
        json={
            "api_key": "test-key-123",
            "query": "Tata EV India",
            "search_depth": "basic",
            "max_results": 4
        },
        headers={"Content-Type": "application/json"},
        timeout=5
    )

@patch.dict("os.environ", {"TAVILY_API_KEY": "test-key-123"})
@patch("services.search_service.requests.post")
def test_search_market_context_http_error(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 401
    mock_response.text = "Unauthorized"
    mock_post.return_value = mock_response

    res = search_market_context("Tata EV India")
    assert res == ""

@patch.dict("os.environ", {"TAVILY_API_KEY": "test-key-123"})
@patch("services.search_service.requests.post")
def test_search_market_context_exception_resiliency(mock_post):
    mock_post.side_effect = Exception("Connection Timeout")

    res = search_market_context("Tata EV India")
    assert res == ""
