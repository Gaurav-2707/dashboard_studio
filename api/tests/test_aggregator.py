"""
Tests for the aggregation service.
"""

import pytest

from services.aggregator import (
    check_mutual_exclusion,
    compute_intersection,
    is_response_row,
)


class TestIsResponseRow:
    def test_regular_response(self):
        assert is_response_row("Very Satisfied") is True

    def test_weighted_sample(self):
        assert is_response_row("Weighted Sample") is False

    def test_unweighted_sample(self):
        assert is_response_row("Unweighted Sample") is False

    def test_mean(self):
        assert is_response_row("MEAN") is False

    def test_sigma(self):
        assert is_response_row("Sigma") is False

    def test_base_row(self):
        assert is_response_row("Base: All respondents") is False

    def test_standard_deviation(self):
        assert is_response_row("Standard Deviation") is False


class TestMutualExclusion:
    def test_sigma_100_detected(self):
        table_data = {
            "Option A": {"Col1": 60, "Col2": 40},
            "Sigma": {"Col1": 100.0, "Col2": 100.0},
        }
        assert check_mutual_exclusion(table_data, ["Col1", "Col2"]) is True

    def test_sigma_not_100(self):
        table_data = {
            "Option A": {"Col1": 60, "Col2": 40},
            "Sigma": {"Col1": 150.0, "Col2": 130.0},
        }
        assert check_mutual_exclusion(table_data, ["Col1", "Col2"]) is False

    def test_no_sigma_row(self):
        table_data = {
            "Option A": {"Col1": 60, "Col2": 40},
        }
        assert check_mutual_exclusion(table_data, ["Col1", "Col2"]) is False


class TestComputeIntersection:
    @pytest.fixture
    def sample_table(self):
        return {
            "Weighted Sample": {"Total": 1000, "Col A": 400, "Col B": 300},
            "Unweighted Sample": {"Total": 950, "Col A": 380, "Col B": 290},
            "Very Satisfied": {"Total": 25.0, "Col A": 30.0, "Col B": 20.0},
            "Satisfied": {"Total": 35.0, "Col A": 40.0, "Col B": 25.0},
            "Neutral": {"Total": 20.0, "Col A": 15.0, "Col B": 30.0},
            "Dissatisfied": {"Total": 15.0, "Col A": 10.0, "Col B": 20.0},
            "Very Dissatisfied": {"Total": 5.0, "Col A": 5.0, "Col B": 5.0},
        }

    def test_single_column_passthrough(self, sample_table):
        result = compute_intersection(sample_table, ["Col A"])
        assert result["combined_column_name"] == "Col A"
        assert result["is_mutually_exclusive"] is False
        assert result["rows"]["Very Satisfied"] == 30.0

    def test_two_column_intersection(self, sample_table):
        result = compute_intersection(sample_table, ["Col A", "Col B"])
        assert result["combined_column_name"] == "Col A & Col B"
        assert result["is_mutually_exclusive"] is False
        assert result["combined_base_weighted"] > 0
        # Combined base should be clamped to min(400, 300) = 300
        assert result["combined_base_weighted"] <= 300

    def test_base_clamping(self, sample_table):
        result = compute_intersection(sample_table, ["Col A", "Col B"])
        # The computed base (400 * 300/1000 = 120) should be <= min(400, 300)
        assert result["combined_base_weighted"] <= min(400, 300)

    def test_mutual_exclusion_returns_zero(self):
        table_data = {
            "Weighted Sample": {"Total": 1000, "Col A": 400, "Col B": 600},
            "Option 1": {"Total": 40, "Col A": 100, "Col B": 0},
            "Option 2": {"Total": 60, "Col A": 0, "Col B": 100},
            "Sigma": {"Total": 100, "Col A": 100, "Col B": 100},
        }
        result = compute_intersection(table_data, ["Col A", "Col B"])
        assert result["is_mutually_exclusive"] is True
        assert result["combined_base_weighted"] == 0

    def test_normalization(self, sample_table):
        result = compute_intersection(sample_table, ["Col A", "Col B"])
        # Sum of normalized values should roughly equal average of input column sums
        row_sum = sum(result["rows"].values())
        col_a_sum = sum(
            v for k, v in sample_table.items()
            if is_response_row(k)
            for col, v in [(k, sample_table[k].get("Col A"))]
            if v is not None
        )
        col_b_sum = sum(
            v for k, v in sample_table.items()
            if is_response_row(k)
            for col, v in [(k, sample_table[k].get("Col B"))]
            if v is not None
        )
        avg_input_sum = (col_a_sum + col_b_sum) / 2
        # Allow 1% tolerance
        assert abs(row_sum - avg_input_sum) < avg_input_sum * 0.01
