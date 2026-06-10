"""Adapters from ecosystem data structures to the canonical list-of-dicts.

The hashing and totals pipeline speaks list-of-dicts. Most Python data code
speaks pandas. `to_records` bridges them so `receipt_step` can wrap a
DataFrame-in / DataFrame-out transform without the caller converting anything:
the frame passes through the user's function untouched, and only the hashing
side sees records.

pandas is not a dependency; detection uses the already-imported module, which
is sufficient because a caller passing a DataFrame necessarily imported pandas.
"""

from __future__ import annotations

import sys
from typing import Any


def _pandas():
    return sys.modules.get("pandas")


def is_dataframe(obj: Any) -> bool:
    pd = _pandas()
    return pd is not None and isinstance(obj, pd.DataFrame)


def dataframe_to_records(df: Any) -> list[dict[str, Any]]:
    """Convert a pandas DataFrame to hashable records.

    - Missing values (NaN, NaT, pd.NA) become None, the canonical null. Left
      alone they would stringify ("nan") and hash as text.
    - numpy scalars unwrap to native Python values via .item(); pd.Timestamp
      is a datetime subclass and normalizes through the datetime path.
    - The index is not part of the data and is dropped; reset it into a column
      first if it matters.
    """
    import numpy as np
    pd = _pandas()

    records: list[dict[str, Any]] = []
    for row in df.to_dict("records"):
        clean: dict[str, Any] = {}
        for key, value in row.items():
            if value is None or (pd.api.types.is_scalar(value) and pd.isna(value)):
                clean[key] = None
            elif isinstance(value, np.generic):
                clean[key] = value.item()
            else:
                clean[key] = value
        records.append(clean)
    return records


def to_records(data: Any, *, context: str = "data") -> list[dict[str, Any]]:
    """Normalize transform input/output to list-of-dicts for hashing.

    Lists pass through; DataFrames convert. Anything else is a contract error
    with a message written for the integrator (often a coding agent).
    """
    if isinstance(data, list):
        return data
    if is_dataframe(data):
        return dataframe_to_records(data)
    raise TypeError(
        f"receipt_step {context} must be a list of dicts or a pandas DataFrame, "
        f"got {type(data).__name__}. Convert other structures before the "
        "wrapped function boundary."
    )
