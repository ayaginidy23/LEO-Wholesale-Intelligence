"""Load the analytics outputs ONCE and convert DataFrames to JSON-safe records."""
import json
from functools import lru_cache

import pandas as pd

from core.config import ANALYTICS_DIR, CLEAN_DIR


@lru_cache(maxsize=1)
def get_data() -> dict:
    """Read every analytics file once; later calls return the cached result."""
    d = {name: pd.read_parquet(ANALYTICS_DIR / f"{name}.parquet") for name in [
        "traders", "hidden_traders", "segment_summary", "monthly_by_channel",
        "bot_catalog", "stock_status", "stock_by_size_estimate",
        "forecast", "forecast_by_size", "production_plan", "size_returns_by_product",
    ]}
    with open(ANALYTICS_DIR / "kpis.json", encoding="utf-8") as fh:
        d["kpis"] = json.load(fh)

    # Clean sales (only the columns the API needs) -> trader order history for the bot
    d["sales"] = pd.read_parquet(CLEAN_DIR / "sales.parquet", columns=[
        "Invoice_ID", "Order_Date", "Channel", "Customer_ID", "Product_ID",
        "Size", "Quantity", "Net_Sales_EGP"])
    for col in ["Customer_ID", "Product_ID", "Size", "Channel"]:
        d["sales"][col] = d["sales"][col].astype(str)

    # Parquet returns lists as numpy arrays -> plain lists (JSON-friendly)
    d["bot_catalog"]["Sizes_List"] = d["bot_catalog"]["Sizes_List"].apply(list)

    # hidden_traders was saved with Customer_ID as the index
    if "Customer_ID" not in d["hidden_traders"].columns:
        d["hidden_traders"] = d["hidden_traders"].reset_index()
    return d


def to_records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> list of dicts that JSON can handle (NaN -> null, dates -> ISO text)."""
    return json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))