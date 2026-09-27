"""
Data contracts for the PIT store — every batch is validated before it can
become a snapshot. A violation raises with the failing check named; the
ingestors catch, alert, and drop the batch rather than poison the store.
"""

import pandas as pd
import pandera as pa
from pandera import Column, Check

_SCHEMAS: dict[str, pa.DataFrameSchema] = {
    "prices_eod": pa.DataFrameSchema(
        {
            "symbol": Column(str, Check.str_length(1, 20)),
            "date": Column("datetime64[ns]"),
            "open": Column(float, Check.gt(0), nullable=True),
            "high": Column(float, Check.gt(0), nullable=True),
            "low": Column(float, Check.gt(0), nullable=True),
            "close": Column(float, Check.gt(0)),
            "volume": Column(float, Check.ge(0), nullable=True, coerce=True),
            "source": Column(str),
        },
        checks=[
            Check(lambda df: (df["high"].fillna(df["close"]) >= df["low"].fillna(df["close"])).all(),
                  error="high < low"),
            Check(lambda df: ~df.duplicated(["symbol", "date"]).any(),
                  error="duplicate (symbol, date) rows in one batch"),
        ],
        coerce=True,
    ),
    "fundamentals": pa.DataFrameSchema(
        {
            "cik": Column(str),
            "symbol": Column(str, nullable=True),
            "tag": Column(str),
            "unit": Column(str),
            "period_end": Column("datetime64[ns]"),
            "value": Column(float),
            "filed_at": Column("datetime64[ns]"),
        },
        checks=[
            Check(lambda df: (df["filed_at"] >= df["period_end"]).all(),
                  error="filed before the period ended — impossible, likely a parse bug"),
        ],
        coerce=True,
    ),
    "macro": pa.DataFrameSchema(
        {
            "series": Column(str),
            "date": Column("datetime64[ns]"),
            "value": Column(float, nullable=True),
        },
        coerce=True,
    ),
    "news_tone": pa.DataFrameSchema(
        {
            "date": Column("datetime64[ns]"),
            "theme": Column(str),
            "tone": Column(float, Check.in_range(-100, 100)),
            "articles": Column(int, Check.ge(1), coerce=True),
        },
        coerce=True,
    ),
}


def validate(table: str, df: pd.DataFrame) -> pd.DataFrame:
    if table not in _SCHEMAS:
        raise ValueError(f"no contract for table {table}")
    if df.empty:
        raise ValueError(f"{table}: empty batch — refusing to snapshot nothing")
    return _SCHEMAS[table].validate(df, lazy=False)
