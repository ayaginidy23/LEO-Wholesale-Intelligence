import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api.js";

// Friendly names for the tools the bot used (shown under each reply)
const TOOL_LABELS = {
  search_products: "Searched catalog",
  check_stock: "Checked stock",
  get_price: "Calculated price",
  get_clearance_offers: "Clearance offers",
  get_trader_profile: "Read trader profile",
  create_order: "Created order",
  record_unmet_demand: "Logged unmet demand",
};

const SUGGESTIONS = [
  "السلام عليكم، عندكم بيجامات بناتي صيفي؟",
  "P001 مقاس 8 متوفر منه كام؟",
  "عايز 48 قطعة، بكام؟",
  "عندكم عروض تصفية؟",
];

const newSessionId = () => crypto.randomUUID();

export default function Chat() {
  const [customerId, setCustomerId] = useState("C13351");
  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState([]);       // [{role, text, tools, model}]
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const bottomRef = useRef(null);

  // Auto-scroll to the newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Load recent bot orders once when the page opens
  useEffect(() => { loadOrders(); }, []);

  async function loadOrders() {
    try {
      const data = await api.botOrders();
      setOrders(data.items.slice(-5).reverse());
    } catch { /* orders panel is optional */ }
  }

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || loading) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setLoading(true);
    try {
      const res = await api.chat({ session_id: sessionId, customer_id: customerId || null, message });
      setMessages((m) => [...m, { role: "bot", text: res.reply, tools: res.tools_used, model: res.model }]);
      if (res.tools_used?.includes("create_order")) loadOrders();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // New conversation (also needed when switching trader: the bot is told who the trader is at the start)
  function resetChat() {
    api.resetChat(sessionId).catch(() => {});
    setSessionId(newSessionId());
    setMessages([]);
    setError("");
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] h-full">
      {/* ---------- Chat panel ---------- */}
      <section className="flex flex-col h-full min-h-0 border-r border-slate-200">
        {/* Header */}
        <header className="flex items-center gap-3 px-5 py-3 bg-emerald-700 text-white">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold">L</div>
          <div className="flex-1">
            <div className="font-semibold">LEO Wholesale Assistant</div>
            <div className="text-xs text-emerald-100">{loading ? "typing…" : "online · answers from live company data"}</div>
          </div>
          <label className="text-xs text-emerald-100">Trader</label>
          <input
            value={customerId}
            onChange={(e) => { setCustomerId(e.target.value.toUpperCase()); resetChat(); }}
            className="w-24 px-2 py-1 rounded bg-white/15 text-white text-sm outline-none focus:bg-white/25"
          />
          <button onClick={resetChat} className="text-xs px-3 py-1.5 rounded bg-white/15 hover:bg-white/25">
            New chat
          </button>
        </header>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-3 bg-[#efeae2]">
          {messages.length === 0 && (
            <div className="text-center text-sm text-slate-500 mt-10">
              Start the conversation as trader <b>{customerId || "(unknown)"}</b>, or try a suggestion below.
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                dir="auto"
                className={`max-w-[75%] rounded-xl px-4 py-2 shadow-sm text-[15px] leading-relaxed ${
                  m.role === "user" ? "bg-[#d9fdd3]" : "bg-white"
                }`}
                style={{ fontFamily: "Cairo, Inter, sans-serif" }}
              >
                {m.role === "bot" ? (
                  <div className="space-y-1 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5">
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{m.text}</div>
                )}

                {m.tools?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2" dir="ltr">
                    {[...new Set(m.tools)].map((t) => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ✓ {TOOL_LABELS[t] || t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white rounded-xl px-4 py-2 shadow-sm text-slate-400 text-sm">LEO is checking the data…</div>
            </div>
          )}
          {error && (
            <div className="text-center text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions + input */}
        <div className="p-3 bg-white border-t border-slate-200 space-y-2">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2" dir="rtl">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="text-sm px-3 py-1.5 rounded-full border border-emerald-300 text-emerald-800 hover:bg-emerald-50">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
            <input
              dir="auto"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اكتب رسالتك…"
              className="flex-1 px-4 py-2.5 rounded-full border border-slate-300 outline-none focus:border-emerald-500"
              style={{ fontFamily: "Cairo, Inter, sans-serif" }}
            />
            <button disabled={loading || !input.trim()}
              className="px-5 rounded-full bg-emerald-600 text-white font-medium disabled:opacity-40">
              Send
            </button>
          </form>
        </div>
      </section>

      {/* ---------- Side panel ---------- */}
      <aside className="hidden lg:block p-5 space-y-5 overflow-y-auto bg-white">
        <div>
          <h3 className="font-semibold text-slate-800 mb-2">How the assistant works</h3>
          <ul className="text-sm text-slate-600 space-y-1.5 list-disc ps-5">
            <li>Every price, stock level and size comes from a <b>tool call</b> on company data — never invented.</li>
            <li>Per-size stock is an <b>estimate</b> (stock × recent size mix).</li>
            <li>Pushes <b>clearance stock</b> with a price floor of cost + 5%.</li>
            <li>Gives <b>size advice</b> (35% of returns are size/fit).</li>
            <li>Logs <b>unmet demand</b> for production planning.</li>
          </ul>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-800">Orders created by the bot</h3>
            <button onClick={loadOrders} className="text-xs text-emerald-700 hover:underline">refresh</button>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-slate-400">No orders yet.</p>
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.order_id} className="text-sm border border-slate-200 rounded-lg p-2">
                  <div className="font-medium">{o.order_id}</div>
                  <div className="text-slate-600" dir="auto">{o.product_name}</div>
                  <div className="text-slate-500 text-xs">
                    {o.customer_id} · size {o.size} · {o.quantity_confirmed}/{o.quantity_requested} pcs ·{" "}
                    {Number(o.total_confirmed_egp).toLocaleString()} EGP
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}