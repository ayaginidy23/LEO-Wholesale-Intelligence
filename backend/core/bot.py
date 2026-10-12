"""Gemini-powered wholesale assistant with function calling, per-session memory,
and automatic fallback to backup models when the main one is busy."""
import time

from google import genai
from google.genai import types

from core.config import GEMINI_API_KEY, GEMINI_MODELS
from core.bot_tools import TOOLS

SYSTEM_PROMPT = """You are "LEO", the wholesale assistant of El-Sharnouby Group (LEO MODA),
a kids' and women's pajama/homewear manufacturer. Wholesale desk: 5 Amin Yehia St, Zizinia, Alexandria.
You chat with wholesale traders (shop owners) on WhatsApp.

LANGUAGE AND STYLE
- Reply in the trader's language; default to Egyptian Arabic. Short WhatsApp-style messages.
- Be warm and professional. Use simple lists for multiple products.

TRUTHFULNESS (most important)
- NEVER invent products, prices, stock, sizes or dates. Always get them from your tools.
- Per-size stock is an ESTIMATE: say "حوالي" (approximately).
- If a tool returns an error, say so honestly and offer an alternative.

SELLING RULES
- Prices are wholesale EGP per piece. If a product is on clearance, use the clearance price and say it's a special offer.
- Mention clearance offers when relevant (at most once per conversation, don't spam).
- If stock is low or out: suggest similar available products, say restock takes about
  `restock_lead_days` days, and call record_unmet_demand.
- Never offer discounts beyond the prices returned by the tools.

SIZE ADVICE (35% of returns are size/fit problems)
- Kids sizes 4, 6, 8, 10, 12 roughly match the child's age in years.
  If between sizes, recommend the bigger one.
- If check_stock returns size_fit_warning = true, tell the trader this model runs small
  and recommend one size up.
- Women sizes: M, L, XL, 2XL.

ORDERS
- Before calling create_order, summarise: product, size, quantity, unit price, total — and ask for confirmation.
- Only call create_order after a clear "yes"/"أكّد"/"تمام".
- After an order, give the order ID. If part is backordered, explain clearly.
- Payment is usually by bank transfer; the sales team will send the details (never invent bank details).

PRIVACY
- Only discuss the current trader's own data. Never reveal other traders' information.
"""

# Temporary errors worth retrying: rate limit (429), server error (500), overloaded (503)
RETRY_CODES = {429, 500, 503}

_client = None
_sessions: dict = {}     # session_id -> {"chat": ..., "model": ..., "customer_id": ...}


def _get_client():
    """Create the Gemini client once and reuse it."""
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is missing in the .env file")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def _new_chat(customer_id, model, history=None):
    """Start a chat on `model`. Passing `history` moves an ongoing conversation to another model."""
    if customer_id:
        context = (f"\n\nCURRENT TRADER: Customer_ID = {customer_id}. "
                   "Call get_trader_profile at the start to personalise your help.")
    else:
        context = ("\n\nCURRENT TRADER: unknown. Ask for their trader code (e.g. C13351) "
                   "before creating any order.")
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT + context,
        tools=TOOLS,              # Python functions -> the SDK calls them automatically
        temperature=0.3,          # low = more factual and consistent
    )
    return _get_client().chats.create(model=model, config=config, history=history or [])


def _tool_calls(history) -> list[str]:
    """Names of the tools the model called (shown in the UI)."""
    names = []
    for content in history:
        for part in (content.parts or []):
            fc = getattr(part, "function_call", None)
            if fc:
                names.append(fc.name)
    return names


def chat(session_id: str, message: str, customer_id: str | None = None) -> dict:
    """Send one trader message and return the bot reply, tools used, and the model that answered."""
    s = _sessions.get(session_id)
    if s is None:
        s = {"chat": _new_chat(customer_id, GEMINI_MODELS[0]),
             "model": GEMINI_MODELS[0], "customer_id": customer_id}
        _sessions[session_id] = s

    # Try the current model first, then the backups in order
    start = GEMINI_MODELS.index(s["model"]) if s["model"] in GEMINI_MODELS else 0
    order = GEMINI_MODELS[start:] + GEMINI_MODELS[:start]
    last_error = None

    for model in order:
        if model != s["model"]:
            # Switch model but KEEP the conversation so far
            s["chat"] = _new_chat(s["customer_id"], model, s["chat"].get_history())
            s["model"] = model
        for attempt in range(2):                      # 2 tries per model
            try:
                before = len(s["chat"].get_history())
                response = s["chat"].send_message(message)
                try:
                    tools_used = _tool_calls(s["chat"].get_history()[before:])
                except Exception:
                    tools_used = []
                return {"reply": response.text or "", "tools_used": tools_used, "model": model}
            except Exception as e:
                code = getattr(e, "code", None)
                if code not in RETRY_CODES:
                    raise                              # a real error -> show it
                last_error = e
                print(f"[bot] {model} busy ({code}), attempt {attempt + 1}")
                time.sleep(2)

    raise RuntimeError(f"All Gemini models are busy right now. Last error: {last_error}")


def reset(session_id: str):
    """Forget a conversation (start fresh)."""
    _sessions.pop(session_id, None)