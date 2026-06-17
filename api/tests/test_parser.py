"""
Tests for the Calamine Excel parser.
"""

import io
import openpyxl
import pytest
from services.parser import parse_excel_to_json


def test_parse_valid_excel():
    # 1. Create a mock workbook
    wb = openpyxl.Workbook()

    # Setup Index sheet
    ws_index = wb.active
    ws_index.title = "Index"
    ws_index.append(["", ""])
    ws_index.append(["Table No.", "Table Description"]) # Header row containing "Table"
    ws_index.append(["Table 1", "Question 1 Description"])

    # Setup Tables sheet
    ws_tables = wb.create_sheet(title="Tables")
    ws_tables.append(["Table 1", ""])
    ws_tables.append(["Question 1 Description", ""])
    ws_tables.append(["", ""])
    ws_tables.append(["", ""])
    ws_tables.append(["", "Total", "Col A", "Col B"])  # Header row
    ws_tables.append(["Weighted Sample", 100, 50, 50])
    ws_tables.append(["Unweighted Sample", 90, 45, 45])
    ws_tables.append(["Very Satisfied", 60.0, 30.0, 30.0])
    ws_tables.append(["Dissatisfied", 40.0, 20.0, 20.0])
    ws_tables.append(["Sigma", 100.0, 100.0, 100.0])

    # Save to bytes
    stream = io.BytesIO()
    wb.save(stream)
    file_bytes = stream.getvalue()

    # 2. Parse using Calamine parser
    result = parse_excel_to_json(file_bytes)

    # 3. Assert correct structure
    assert "1" in result
    assert result["1"]["title"] == "Question 1 Description"
    table_data = result["1"]["data"]

    assert "Weighted Sample" in table_data
    assert table_data["Weighted Sample"]["Total"] == 100
    assert table_data["Weighted Sample"]["Col A"] == 50

    assert "Very Satisfied" in table_data
    assert table_data["Very Satisfied"]["Total"] == 60.0
    assert table_data["Very Satisfied"]["Col A"] == 30.0
