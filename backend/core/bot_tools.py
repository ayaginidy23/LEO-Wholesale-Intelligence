"""Tools the AI assistant can call.
Gemini reads each function's name, type hints and DOCSTRING to decide when and how to use it,
so the docstrings below are written for the model, not just for humans."""
import csv
import re
import uuid
from datetime import datetime
from functools import lru_cache

from core.config import BOT_DIR
from core.loader import get_data, to_records

ORDERS_FILE  = BOT_DIR / "orders.csv"
SIGNALS_FILE = BOT_DIR / "demand_signals.csv"

# ---------------- Arabic-friendly search ----------------
_AR_LETTERS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي"})
_TASHKEEL = re.compile("[\u064B-\u0652]")          # Arabic diacritics

def normalize(text) -> str:
    """Lowercase, unify Arabic letter variants and remove diacritics (for searching only)."""
    text = _TASHKEEL.sub("", str(text).lower().translate(_AR_LETTERS))
    return re.sub(r"\s+", " ", text).strip()

# Arabic/English words a trader might use for each catalog attribute
SYNONYMS = {
    "Girls": "girls girl بنات بناتي بنت",
    "Boys": "boys boy ولاد ولادي ولد",
    "Unisex": "unisex بنات ولاد",
    "Women": "women ladies حريمي ستات حريم",
    "Kids": "kids children اطفال طفل",
    "Pajamas/Homewear": "pajamas pyjamas بيجامه بيجامات",
    "T-Shirts": "tshirt t-shirt تيشيرت تيشرت",
    "Sweatshirts": "sweatshirt سويتشيرت",
    "Kids Sets": "set sets طقم اطقم",
    "Summer": "summer صيفي صيف",
    "Autumn/Winter": "winter autumn شتوي شتا خريفي",
}

@lru_cache(maxsize=1)
def _catalog():
    """Catalog + a pre-built normalized search text per product (built once)."""
    cat = get_data()["bot_catalog"].copy()

    def search_text(row):
        parts = [row["Product_Name"], row["Product_ID"]]
        for col in ["Gender", "Audience", "Product_Family", "Season"]:
            value = str(row[col])
            parts += [value, SYNONYMS.get(value, "")]
        return normalize(" ".join(parts))

    cat["_search"] = cat.apply(search_text, axis=1)
    return cat.set_index("Product_ID", drop=False)

def _product(product_id):
    cat = _catalog()
    pid = str(product_id).strip().upper()
    return cat.loc[pid] if pid in cat.index else None

def _size_estimates(product_id) -> dict:
    est = get_data()["stock_by_size_estimate"]
    rows = est[est["Product_ID"] == product_id]
    return {str(r.Size): int(r.Est_Stock_Size) for r in rows.itertuples()}

def _append_csv(path, row: dict):
    is_new = not path.exists()
    with open(path, "a", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(row.keys()))
        if is_new:
            writer.writeheader()
        writer.writerow(row)

def _unit_price(p) -> float:
    """Clearance price if the product is on clearance, otherwise the normal wholesale price."""
    if bool(p["Clearance"]) and p["Clearance_Price"] == p["Clearance_Price"]:   # x == x is False for NaN
        return float(p["Clearance_Price"])
    return float(p["Wholesale_Price"])

# ---------------- Tools ----------------
def search_products(query: str = "", season: str = "", clearance_only: bool = False) -> dict:
    """Search the LEO MODA wholesale catalog. Use this for ANY question about which products exist.

    Args:
        query: free text in Arabic or English, e.g. "بيجامة بناتي صيفي", "boys sweatshirt",
               a product name, or a product ID like "P001". Empty = best-stocked products.
        season: optional filter, "Summer" or "Autumn/Winter".
        clearance_only: True to return only products on clearance offer.

    Returns up to 8 products: id, name, audience, gender, family, season, sizes,
    wholesale price (EGP per piece), stock at the wholesale desk, clearance flag and price.
    """
    cat = _catalog()
    if season:
        cat = cat[cat["Season"].astype(str).str.lower() == season.lower()]
    if clearance_only:
        cat = cat[cat["Clearance"]]
    words = [w for w in normalize(query).split() if len(w) > 1]
    if words:
        score = cat["_search"].apply(lambda s: sum(w in s for w in words))
        cat = cat[score > 0].assign(_score=score[score > 0]) \
                 .sort_values(["_score", "Stock_Wholesale_Desk"], ascending=False)
    else:
        cat = cat.sort_values("Stock_Wholesale_Desk", ascending=False)
    cols = ["Product_ID", "Product_Name", "Audience", "Gender", "Product_Family", "Season",
            "Sizes_List", "Wholesale_Price", "Stock_Wholesale_Desk", "Clearance", "Clearance_Price"]
    return {"count": int(len(cat)), "products": to_records(cat[cols].head(8))}


def check_stock(product_id: str, size: str = "") -> dict:
    """Check stock for one product at the wholesale desk (and other locations).

    Args:
        product_id: product ID like "P001" (get it from search_products first).
        size: optional size, e.g. "8" for kids or "XL" for women.

    Returns total wholesale-desk stock, its status, APPROXIMATE stock per size
    (estimated from recent size mix — always say "approximately"), stock at other
    locations, restock lead time in days, and whether the product has a size-fit warning.
    """
    p = _product(product_id)
    if p is None:
        return {"error": f"Product {product_id} not found"}
    pid = p["Product_ID"]
    sizes = [str(s) for s in p["Sizes_List"]]
    per_size = _size_estimates(pid)

    result = {
        "product_id": pid,
        "product_name": p["Product_Name"],
        "available_sizes": sizes,
        "wholesale_desk_stock_total": int(p["Stock_Wholesale_Desk"]),
        "wholesale_desk_status": str(p["Stock_Status_Desk"]),
        "approx_stock_by_size": per_size,
        "restock_lead_days": int(p["Restock_Lead_Days"]),
        "size_fit_warning": bool(p["Size_Fit_Warning"]),
    }
    if size:
        s = str(size).strip().upper()
        if s not in sizes:
            return {**result, "error": f"Size {s} is not made for this product"}
        result["requested_size"] = s
        result["approx_stock_requested_size"] = per_size.get(s, 0)

    others = get_data()["stock_status"]
    others = others[(others["Product_ID"] == pid) & (others["Location_ID"] != "LOC003")]
    result["other_locations"] = [
        {"location": r.Location_Short, "stock": int(r.Closing_Stock), "status": r.Stock_Status}
        for r in others.itertuples()]
    return result


def get_price(product_id: str, quantity: int = 1) -> dict:
    """Wholesale price for a product and quantity (EGP). Uses the clearance price if on clearance.

    Args:
        product_id: product ID like "P001".
        quantity: number of pieces.
    """
    p = _product(product_id)
    if p is None:
        return {"error": f"Product {product_id} not found"}
    unit = _unit_price(p)
    return {
        "product_id": p["Product_ID"],
        "product_name": p["Product_Name"],
        "unit_price_egp": round(unit, 2),
        "regular_wholesale_price_egp": round(float(p["Wholesale_Price"]), 2),
        "on_clearance": bool(p["Clearance"]),
        "quantity": int(quantity),
        "total_egp": round(unit * int(quantity), 2),
    }


def get_clearance_offers() -> dict:
    """List current clearance offers (overstocked products at a special wholesale price).
    Mention these to traders when relevant — they help the company clear old stock."""
    cat = _catalog()
    offers = cat[cat["Clearance"]].copy()
    offers["Saving_Per_Piece"] = (offers["Wholesale_Price"] - offers["Clearance_Price"]).round(2)
    cols = ["Product_ID", "Product_Name", "Season", "Sizes_List", "Wholesale_Price",
            "Clearance_Price", "Saving_Per_Piece", "Stock_All_Locations", "Size_Fit_Warning"]
    return {"offers": to_records(offers[cols])}


def get_trader_profile(customer_id: str) -> dict:
    """Profile of the trader you are talking to: segment, governorate, ordering rhythm,
    last orders and favourite products. Use it to personalise suggestions (e.g. repeat last order).

    Args:
        customer_id: trader code like "C13351".
    """
    d = get_data()
    t = d["traders"][d["traders"]["Customer_ID"] == str(customer_id).strip().upper()]
    if t.empty:
        return {"error": f"Trader {customer_id} not found"}
    t = t.iloc[0]
    names = _catalog()["Product_Name"]
    orders = d["sales"][d["sales"]["Customer_ID"] == t["Customer_ID"]]
    recent = orders.sort_values("Order_Date", ascending=False).head(5)
    fav = orders.groupby("Product_ID")["Quantity"].sum().sort_values(ascending=False).head(3)
    return {
        "customer_id": t["Customer_ID"],
        "governorate": str(t["Governorate"]),
        "segment": str(t["Segment"]),
        "total_orders": int(t["Orders"]) if t["Orders"] == t["Orders"] else 0,
        "days_since_last_order": None if t["Recency_Days"] != t["Recency_Days"] else int(t["Recency_Days"]),
        "usual_days_between_orders": None if t["Avg_Gap"] != t["Avg_Gap"] else round(float(t["Avg_Gap"]), 1),
        "recent_orders": [{"date": str(r.Order_Date.date()), "product_id": r.Product_ID,
                           "product_name": names.get(r.Product_ID, r.Product_ID),
                           "size": r.Size, "quantity": int(r.Quantity)} for r in recent.itertuples()],
        "favourite_products": [{"product_id": pid, "product_name": names.get(pid, pid),
                                "total_units": int(q)} for pid, q in fav.items()],
    }


def create_order(customer_id: str, product_id: str, size: str, quantity: int) -> dict:
    """Create a wholesale order. ONLY call this after the trader has explicitly confirmed
    the product, size, quantity and total price.

    Args:
        customer_id: trader code like "C13351".
        product_id: product ID like "P001".
        size: size, e.g. "8" or "XL".
        quantity: number of pieces (positive).

    If approximate stock is lower than the quantity, the available part is confirmed and
    the rest is recorded as a backorder (and as unmet demand for production planning).
    """
    p = _product(product_id)
    if p is None:
        return {"error": f"Product {product_id} not found"}
    s = str(size).strip().upper()
    sizes = [str(x) for x in p["Sizes_List"]]
    if s not in sizes:
        return {"error": f"Size {s} is not made for this product", "available_sizes": sizes}
    qty = int(quantity)
    if qty <= 0:
        return {"error": "Quantity must be positive"}

    available = _size_estimates(p["Product_ID"]).get(s, 0)
    confirmed = min(qty, available)
    backorder = qty - confirmed
    unit = _unit_price(p)
    order = {
        "order_id": "BOT-" + uuid.uuid4().hex[:8].upper(),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "customer_id": str(customer_id).strip().upper(),
        "product_id": p["Product_ID"],
        "product_name": p["Product_Name"],
        "size": s,
        "quantity_requested": qty,
        "quantity_confirmed": confirmed,
        "quantity_backorder": backorder,
        "unit_price_egp": round(unit, 2),
        "total_confirmed_egp": round(unit * confirmed, 2),
        "clearance": bool(p["Clearance"]),
    }
    _append_csv(ORDERS_FILE, order)
    if backorder > 0:
        record_unmet_demand(p["Product_ID"], s, backorder, customer_id)
        order["restock_lead_days"] = int(p["Restock_Lead_Days"])
    order["status"] = "confirmed" if backorder == 0 else "partially confirmed"
    return order


def record_unmet_demand(product_id: str, size: str, quantity: int, customer_id: str = "") -> dict:
    """Record demand we could NOT serve (product/size out of stock or not enough).
    Call this whenever a trader wants something that isn't available — it feeds production planning.

    Args:
        product_id: product ID like "P001".
        size: requested size.
        quantity: pieces wanted but not available.
        customer_id: trader code if known.
    """
    row = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "customer_id": str(customer_id).strip().upper(),
        "product_id": str(product_id).strip().upper(),
        "size": str(size).strip().upper(),
        "quantity": int(quantity),
    }
    _append_csv(SIGNALS_FILE, row)
    return {"recorded": True, **row}


TOOLS = [search_products, check_stock, get_price, get_clearance_offers,
         get_trader_profile, create_order, record_unmet_demand]