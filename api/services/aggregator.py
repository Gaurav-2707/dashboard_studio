"""
Dashify — Intersection Aggregation Engine
Ported from dash_no_ai.py compute_intersection_column() with added
mutual exclusion detection (Sigma check) and base clamping.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Row labels that are NOT response answers
NON_RESPONSE_ROWS = {
    "UNWEIGHTED SAMPLE",
    "WEIGHTED SAMPLE",
    "MEAN",
    "MEDIAN",
    "MODE",
    "SD",
    "SE",
    "STD",
    "STANDARD ERROR",
    "STANDARD DEVIATION",
}


def _to_number(value: Any) -> float | None:
    """Attempt to parse a value as float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def is_response_row(label: str) -> bool:
    """Check if a row label is a survey response (not a statistic or base)."""
    label_upper = str(label).strip().upper()
    normalized = " ".join(
        "".join(c for c in label_upper if c.isalnum() or c.isspace()).split()
    )
    return not (
        label_upper in NON_RESPONSE_ROWS
        or normalized in NON_RESPONSE_ROWS
        or label_upper.startswith("BASE")
        or normalized.startswith("BASE")
        or "SIGMA" in label_upper
    )


def check_mutual_exclusion(table_data: dict[str, dict], column_ids: list[str]) -> bool:
    """
    Check if the selected columns belong to the same single-choice question
    by examining the Sigma row. If Sigma ≈ 100 (or 1.0), the columns are
    mutually exclusive and cannot be intersected.

    Returns True if the columns are mutually exclusive (intersection = 0).
    """
    # Look for a Sigma row in the table data
    for row_label, row_data in table_data.items():
        if "SIGMA" in row_label.upper():
            # Check if any of the selected columns have a Sigma value of ~100 or ~1.0
            for col_id in column_ids:
                sigma_val = _to_number(row_data.get(col_id))
                if sigma_val is not None:
                    # Sigma = 100% (percentage) or 1.0 (fraction) indicates single-choice
                    if abs(sigma_val - 100.0) < 0.5 or abs(sigma_val - 1.0) < 0.01:
                        logger.info(
                            f"Mutual exclusion detected: Sigma={sigma_val} for column '{col_id}'"
                        )
                        return True
    return False


def compute_intersection(
    table_data: dict[str, dict],
    column_ids: list[str],
) -> dict[str, Any]:
    """
    Compute the intersection of multiple survey columns within a single table.

    This implements the dynamic intersection math:
    1. Mutual Exclusion Check (via Sigma)
    2. Base Calculation: Combined_Base = Base_1 * (Base_2/Total) * (Base_3/Total) ...
    3. Clamping: Combined_Base <= min(Base_1, Base_2, ...)
    4. Cell Normalization: Ratio multiplication + column-sum normalization

    Args:
        table_data: The "data" dict from a parsed survey table.
        column_ids: List of column names to intersect.

    Returns:
        {
            "combined_column_name": "Col A & Col B",
            "is_mutually_exclusive": false,
            "combined_base_weighted": 123.4,
            "combined_base_unweighted": 120.0,
            "rows": {
                "Response Label": value,
                ...
            }
        }
    """
    if len(column_ids) < 2:
        # Single column — no intersection needed
        col = column_ids[0] if column_ids else "Total"
        rows = {}
        for label, row_data in table_data.items():
            if is_response_row(label):
                val = _to_number(row_data.get(col))
                if val is not None:
                    rows[label] = val
        return {
            "combined_column_name": col,
            "is_mutually_exclusive": False,
            "combined_base_weighted": _to_number(
                table_data.get("Weighted Sample", {}).get(col)
            ),
            "combined_base_unweighted": _to_number(
                table_data.get("Unweighted Sample", {}).get(col)
            ),
            "rows": rows,
        }

    combined_name = " & ".join(column_ids)

    # --- 1. Mutual Exclusion Check ---
    if check_mutual_exclusion(table_data, column_ids):
        return {
            "combined_column_name": combined_name,
            "is_mutually_exclusive": True,
            "combined_base_weighted": 0,
            "combined_base_unweighted": 0,
            "rows": {},
        }

    # --- 2. Base Calculation ---
    combined_bases: dict[str, float] = {}
    for base_key in ["Weighted Sample", "Unweighted Sample"]:
        if base_key not in table_data:
            combined_bases[base_key] = 0.0
            continue

        base_row = table_data[base_key]
        total_base = _to_number(base_row.get("Total"))

        bases = [_to_number(base_row.get(col)) for col in column_ids if col in base_row]
        valid_bases = [b for b in bases if b is not None and b > 0]

        if not valid_bases:
            combined_bases[base_key] = 0.0
        elif total_base is None or total_base <= 0:
            # No Total available — use minimum as fallback
            combined_bases[base_key] = min(valid_bases)
        else:
            # Combined Base = Base_1 * (Base_2/Total) * (Base_3/Total) ...
            prod = valid_bases[0]
            for b in valid_bases[1:]:
                prod *= b / total_base
            # --- 3. Clamping ---
            combined_bases[base_key] = min(prod, min(valid_bases))

    # --- 4. Cell Normalization ---
    response_labels = [label for label in table_data if is_response_row(label)]

    # Check if the calculated weighted base is essentially 0
    weighted_base = combined_bases.get("Weighted Sample", 0.0)
    is_empty_base = weighted_base < 0.5

    raw_vals: dict[str, float] = {}
    sum_raw = 0.0
    sum_inputs: dict[str, float] = {col: 0.0 for col in column_ids}

    for label in response_labels:
        row_data = table_data[label]
        total_val = _to_number(row_data.get("Total"))

        col_vals: list[float] = []
        for col in column_ids:
            val = _to_number(row_data.get(col))
            if val is not None:
                col_vals.append(val)
                sum_inputs[col] += val

        if not col_vals:
            continue

        if total_val is None or total_val <= 0:
            est = sum(col_vals) / len(col_vals)
        else:
            # Overflow-safe ratio multiplication
            est = col_vals[0]
            for v in col_vals[1:]:
                est *= v / total_val

        raw_vals[label] = est
        sum_raw += est

    # Normalize so column sums match average of input column sums
    avg_sum_inputs = (
        sum(sum_inputs.values()) / len(column_ids) if column_ids else 100.0
    )
    factor = avg_sum_inputs / sum_raw if sum_raw > 0 else 1.0

    rows: dict[str, float] = {}
    for label in response_labels:
        if is_empty_base:
            rows[label] = 0.0
        elif label in raw_vals:
            rows[label] = round(raw_vals[label] * factor, 4)

    return {
        "combined_column_name": combined_name,
        "is_mutually_exclusive": False,
        "combined_base_weighted": round(combined_bases.get("Weighted Sample", 0.0), 2),
        "combined_base_unweighted": round(
            combined_bases.get("Unweighted Sample", 0.0), 2
        ),
        "rows": rows,
    }
