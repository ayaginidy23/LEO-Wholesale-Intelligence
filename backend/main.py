"""LEO Wholesale Intelligence — API."""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from core.config import FRONTEND_ORIGINS
from core.loader import get_data, to_records

import pandas as pd
from pydantic import BaseModel

from core import bot
from core.bot_tools import ORDERS_FILE, SIGNALS_FILE

app = FastAPI(title="LEO Wholesale Intelligence API", version="1.0")

# Allow the React dev server (another port) to call this API from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def load_on_startup():
    """Load all data when the server starts (so the first request is fast)."""
    d = get_data()
    print(f"Data loaded: {len(d['traders'])} traders, {len(d['bot_catalog'])} products")


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------- Overview ----------------
@app.get("/api/kpis")
def kpis():
    d = get_data()
    return {
        "kpis": d["kpis"],
        "monthly": to_records(d["monthly_by_channel"]),
        "segments": to_records(d["segment_summary"]),
    }


# ---------------- Traders ----------------
TRADER_LIST_COLS = ["Customer_ID", "Governorate", "Segment", "RFM", "Orders", "Revenue", "Profit",
                    "Margin", "Avg_Discount", "Recency_Days", "Avg_Gap", "Overdue_Ratio",
                    "Overdue_Flag", "Is_Opted_In", "Contact_By", "Action", "Low_Margin_Big_Buyer"]

@app.get("/api/traders")
def traders(
    segment: str | None = None,
    overdue_only: bool = False,
    opted_in: bool | None = None,
    governorate: str | None = None,
    search: str | None = None,
    sort_by: str = "Revenue",
    limit: int = Query(100, ge=1, le=5000)
):
    df = get_data()["traders"]
    if segment:
        df = df[df["Segment"] == segment]
    if overdue_only:
        df = df[df["Overdue_Flag"].fillna(False)]
    if opted_in is not None:
        df = df[df["Is_Opted_In"].fillna(False) == opted_in]
    if governorate:
        df = df[df["Governorate"].astype(str) == governorate]
    if search:
        df = df[df["Customer_ID"].str.contains(search, case=False, na=False)]
    if sort_by in df.columns:
        df = df.sort_values(sort_by, ascending=(sort_by == "Recency_Days"))
    cols = [c for c in TRADER_LIST_COLS if c in df.columns]
    return {"total": len(df), "items": to_records(df[cols].head(limit))}


@app.get("/api/traders/{customer_id}")
def trader_detail(customer_id: str):
    d = get_data()
    row = d["traders"][d["traders"]["Customer_ID"] == customer_id]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Trader {customer_id} not found")

    orders = d["sales"][d["sales"]["Customer_ID"] == customer_id]
    names = d["bot_catalog"].set_index("Product_ID")["Product_Name"]
    recent = orders.sort_values("Order_Date", ascending=False).head(10).copy()
    recent["Product_Name"] = recent["Product_ID"].map(names)
    favorites = (orders.groupby("Product_ID")["Quantity"].sum()
                       .sort_values(ascending=False).head(3).reset_index())
    favorites["Product_Name"] = favorites["Product_ID"].map(names)

    return {
        "trader": to_records(row)[0],
        "recent_orders": to_records(recent),
        "favorite_products": to_records(favorites),
    }


@app.get("/api/hidden-traders")
def hidden_traders(limit: int = Query(50, ge=1, le=2000)):
    df = get_data()["hidden_traders"]
    return {"total": len(df), "items": to_records(df.head(limit))}


# ---------------- Products & stock ----------------
@app.get("/api/products")
def products(audience: str | None = None, gender: str | None = None,
             family: str | None = None, season: str | None = None,
             clearance_only: bool = False):
    df = get_data()["bot_catalog"]
    for col, val in [("Audience", audience), ("Gender", gender),
                     ("Product_Family", family), ("Season", season)]:
        if val:
            df = df[df[col].astype(str).str.lower() == val.lower()]
    if clearance_only:
        df = df[df["Clearance"]]
    return {"total": len(df), "items": to_records(df)}


@app.get("/api/products/{product_id}")
def product_detail(product_id: str):
    d = get_data()
    row = d["bot_catalog"][d["bot_catalog"]["Product_ID"] == product_id]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    sizes = d["stock_by_size_estimate"]
    fc_sizes = d["forecast_by_size"]
    return {
        "product": to_records(row)[0],
        "stock_by_size_estimate": to_records(sizes[sizes["Product_ID"] == product_id]),
        "forecast": to_records(d["forecast"][d["forecast"]["Product_ID"] == product_id]),
        "forecast_by_size": to_records(fc_sizes[fc_sizes["Product_ID"] == product_id]),
        "stock_by_location": to_records(d["stock_status"][d["stock_status"]["Product_ID"] == product_id]),
    }


@app.get("/api/stock")
def stock(location: str | None = None, status: str | None = None):
    df = get_data()["stock_status"]
    if location:
        df = df[df["Location_ID"] == location]
    if status:
        df = df[df["Stock_Status"] == status]
    summary = df.groupby(["Location_Short", "Stock_Status"]).size().reset_index(name="Products")
    return {"total": len(df), "summary": to_records(summary), "items": to_records(df)}


# ---------------- Forecast & production ----------------
@app.get("/api/forecast")
def forecast():
    d = get_data()
    plan_cols = ["Product_ID", "Stock_Now", "Net_Need_90d", "Plan_To_Produce", "Days_Cover_Forecast"]
    df = d["forecast"].merge(d["production_plan"][plan_cols], on="Product_ID", how="left")
    df = df.sort_values("Forecast_90d", ascending=False)
    totals = {c: float(df[c].sum()) for c in
              ["Forecast_30d", "Forecast_60d", "Forecast_90d", "Stock_Now", "Plan_To_Produce"]}
    return {"totals": totals, "items": to_records(df)}

# ---------------- Bot ----------------


class ChatRequest(BaseModel):
    session_id: str
    message: str
    customer_id: str | None = None


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    try:
        return bot.chat(req.session_id, req.message, req.customer_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bot error: {e}")


@app.post("/api/chat/reset")
def chat_reset(session_id: str):
    bot.reset(session_id)
    return {"ok": True}


@app.get("/api/bot/orders")
def bot_orders():
    if not ORDERS_FILE.exists():
        return {"items": []}
    return {"items": to_records(pd.read_csv(ORDERS_FILE))}


@app.get("/api/bot/demand-signals")
def bot_demand_signals():
    if not SIGNALS_FILE.exists():
        return {"items": []}
    return {"items": to_records(pd.read_csv(SIGNALS_FILE))}