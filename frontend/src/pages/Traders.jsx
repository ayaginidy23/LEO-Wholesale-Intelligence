// Traders page: segments overview, filters, traders table, trader detail drawer, hidden traders
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";

// ---------- Helpers ----------

// Return the first non-empty value among several possible column names.
// If none of the names exist, fall back to the first column whose name matches the field's regex
// (so the page adapts to the real column names in traders.parquet without manual edits).
function pick(row, keys) {
  if (!row) return undefined;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
  }
  if (keys.re) {
    const k = Object.keys(row).find((c) => keys.re.test(c) && !(keys.not && keys.not.test(c)));
    if (k !== undefined && row[k] !== null && row[k] !== "") return row[k];
  }
  return undefined;
}

// Build a field definition: exact names first, then a regex fallback (and an optional exclude regex)
const field = (names, re, not) => Object.assign([...names], { re, not });

// Accept either a plain list or an object like {items: [...]} from the API
function asList(res) {
  if (Array.isArray(res)) return res;
  if (!res || typeof res !== "object") return [];
  return res.items ?? res.traders ?? res.data ?? res.rows ?? [];
}

const fmtNum = (v) =>
  v === undefined || v === null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 });

const fmtEGP = (v) =>
  v === undefined || v === null || isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " EGP";

const fmtDate = (v) => (v ? String(v).slice(0, 10) : "—");

const isTrue = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true" || String(v).toLowerCase() === "yes";

// Possible column names for each field we need
const F = {
  id: field(["Customer_ID"]),
  name: field(["Customer_Name", "Trader_Name", "Name"], /name/i, /product|segment/i),
  gov: field(["Governorate", "City"], /governorate|city/i),
  segment: field(["Segment", "RFM_Segment"], /segment/i),
  revenue: field(
    ["Monetary", "Total_Net_Sales", "Net_Sales_EGP", "Revenue_EGP", "Total_Revenue", "Lifetime_Net_Sales"],
    /net_?sales|revenue|monetary/i,
    /share|pct|ratio|trend|avg|per_|score|rank/i
  ),
  orders: field(["Frequency", "Orders", "Order_Count", "Num_Orders"], /frequency|orders|invoices/i, /avg|score|rank|gap|days/i),
  recency: field(["Recency_Days", "Days_Since_Last_Order", "Recency"], /recency|days_since/i, /score|rank/i),
  lastOrder: field(["Last_Order_Date", "Last_Order"], /last_order/i),
  overdue: field(["Overdue_Flag", "Is_Overdue"], /overdue_flag|is_overdue/i),
  overdueRatio: field(["Overdue_Ratio"], /overdue_ratio/i),
  optIn: field(["WhatsApp_Opt_In", "Opted_In", "Marketing_Opt_In", "Opt_In"], /opt|consent|whatsapp/i),
  action: field(["Next_Action", "Recommended_Action", "Action", "Contact_Route"], /action|route/i),
  margin: field(["Margin_Pct", "Gross_Margin_Pct", "Margin"], /margin/i, /low_margin|flag/i),
};

// Colors per segment (unknown segments fall back to slate)
const SEGMENT_COLORS = {
  Champions: "bg-emerald-100 text-emerald-800",
  Loyal: "bg-teal-100 text-teal-800",
  "Loyal Traders": "bg-teal-100 text-teal-800",
  "Potential Loyalists": "bg-sky-100 text-sky-800",
  "At Risk": "bg-amber-100 text-amber-800",
  "Cant Lose": "bg-red-100 text-red-800",
  "Can't Lose": "bg-red-100 text-red-800",
  Hibernating: "bg-slate-200 text-slate-700",
  Lost: "bg-slate-200 text-slate-600",
  "Never Ordered": "bg-violet-100 text-violet-800",
};
const segClass = (s) => SEGMENT_COLORS[s] ?? "bg-slate-100 text-slate-700";

// ---------- Small UI pieces ----------

function Stat({ label, value, hint, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    violet: "text-violet-600",
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

// Generic table: renders every column of the rows it receives
function DataTable({ rows, max = 50 }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-slate-400">No data.</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {c.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cols.map((c) => (
                <td key={c} className="px-3 py-2 whitespace-nowrap text-slate-700">
                  {typeof r[c] === "number" ? fmtNum(r[c]) : String(r[c] ?? "—").slice(0, 40)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Trader detail drawer ----------

function TraderDrawer({ customerId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customerId) return;
    setData(null);
    setError("");
    api
      .trader(customerId)
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load trader"));
  }, [customerId]);

  if (!customerId) return null;

  const t = data?.trader ?? data;

  return (
    // Dark overlay + white panel on the right
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white shadow-xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-500">{customerId}</div>
            <h2 className="text-xl font-bold text-slate-900">{pick(t, F.name) ?? "Trader"}</h2>
            <div className="text-sm text-slate-500">{pick(t, F.gov) ?? ""}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">
            ×
          </button>
        </div>

        {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
        {!data && !error && <p className="mt-4 text-slate-400 text-sm">Loading...</p>}

        {t && (
          <>
            {/* Headline badges */}
            <div className="flex flex-wrap gap-2 mt-4">
              {pick(t, F.segment) && (
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${segClass(pick(t, F.segment))}`}>
                  {pick(t, F.segment)}
                </span>
              )}
              {isTrue(pick(t, F.overdue)) && (
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Overdue</span>
              )}
              {isTrue(pick(t, F.optIn)) && (
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                  WhatsApp opt-in
                </span>
              )}
            </div>

            {/* Key numbers */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              <Stat label="Net sales" value={fmtEGP(pick(t, F.revenue))} />
              <Stat label="Orders" value={fmtNum(pick(t, F.orders))} />
              <Stat label="Days since order" value={fmtNum(pick(t, F.recency))} />
            </div>

            {pick(t, F.action) && (
              <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
                <b>Next action:</b> {pick(t, F.action)}
              </div>
            )}

            {/* All profile fields */}
            <h3 className="mt-6 mb-2 font-semibold text-slate-800">Profile</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {Object.entries(t).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 py-1">
                  <span className="text-slate-500">{k.replaceAll("_", " ")}</span>
                  <span className="text-slate-800 font-medium text-right ml-2">
                    {typeof v === "number" ? fmtNum(v) : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "—").slice(0, 30)}
                  </span>
                </div>
              ))}
            </div>

            <h3 className="mt-6 mb-2 font-semibold text-slate-800">Favorite products</h3>
            <DataTable rows={data?.favorite_products} max={10} />

            <h3 className="mt-6 mb-2 font-semibold text-slate-800">Recent orders</h3>
            <DataTable rows={data?.recent_orders} max={20} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Main page ----------

export default function Traders() {
  const [all, setAll] = useState([]); // every trader, loaded once
  const [hidden, setHidden] = useState([]); // hidden traders list
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState("all"); // "all" | "hidden"
  const [segment, setSegment] = useState("");
  const [gov, setGov] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [optInOnly, setOptInOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("revenue");
  const [selected, setSelected] = useState(null); // customer id for the drawer

  // Load traders + hidden traders once; filtering happens in the browser (1.6k rows = instant)
  useEffect(() => {
    async function load() {
      try {
        let res;
        try {
          res = await api.traders({ limit: 5000 });
        } catch {
          res = await api.traders({}); // fallback if the backend caps "limit"
        }
        setAll(asList(res));
        try {
          setHidden(asList(await api.hiddenTraders()));
        } catch {
          setHidden([]);
        }
      } catch (e) {
        setError(e.message || "Failed to load traders");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Dropdown options built from the data itself
  const segments = useMemo(() => [...new Set(all.map((r) => pick(r, F.segment)).filter(Boolean))].sort(), [all]);
  const governorates = useMemo(() => [...new Set(all.map((r) => pick(r, F.gov)).filter(Boolean))].sort(), [all]);

  // Segment summary cards: count + revenue + share of revenue
  const segmentSummary = useMemo(() => {
    const total = all.reduce((s, r) => s + (Number(pick(r, F.revenue)) || 0), 0);
    const map = {};
    for (const r of all) {
      const s = pick(r, F.segment) ?? "Unknown";
      map[s] ??= { segment: s, count: 0, revenue: 0, overdue: 0 };
      map[s].count += 1;
      map[s].revenue += Number(pick(r, F.revenue)) || 0;
      if (isTrue(pick(r, F.overdue))) map[s].overdue += 1;
    }
    return Object.values(map)
      .map((x) => ({ ...x, share: total ? (x.revenue / total) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [all]);

  // Apply filters + search + sort
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = all.filter((r) => {
      if (segment && pick(r, F.segment) !== segment) return false;
      if (gov && pick(r, F.gov) !== gov) return false;
      if (overdueOnly && !isTrue(pick(r, F.overdue))) return false;
      if (optInOnly && !isTrue(pick(r, F.optIn))) return false;
      if (q) {
        const text = `${pick(r, F.id) ?? ""} ${pick(r, F.name) ?? ""} ${pick(r, F.gov) ?? ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
    const val = (r) => Number(pick(r, F[sortKey])) || 0;
    // Recency: smallest first (most recent); everything else: biggest first
    return out.sort((a, b) => (sortKey === "recency" ? val(a) - val(b) : val(b) - val(a)));
  }, [all, segment, gov, overdueOnly, optInOnly, search, sortKey]);

  const overdueCount = all.filter((r) => isTrue(pick(r, F.overdue))).length;
  const optInCount = all.filter((r) => isTrue(pick(r, F.optIn))).length;
  const filteredRevenue = rows.reduce((s, r) => s + (Number(pick(r, F.revenue)) || 0), 0);

  // Show a column only if the data actually has it
  const has = (field) => all.some((r) => pick(r, F[field]) !== undefined);

  if (loading) return <div className="p-8 text-slate-500">Loading traders...</div>;
  if (error)
    return (
      <div className="p-8">
        <p className="text-red-600">{error}</p>
        <p className="text-slate-500 text-sm mt-2">Make sure the backend is running on port 8000.</p>
      </div>
    );

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Traders</h1>
        <p className="text-slate-500 mt-1">
          Who buys, who stopped, and who to call first. Descriptive segments from RFM, not a prediction.
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Traders" value={fmtNum(all.length)} />
        <Stat label="Overdue" value={fmtNum(overdueCount)} hint="Gap since last order ≥ 2× their usual cycle" tone="amber" />
        <Stat label="WhatsApp opt-in" value={has("optIn") ? fmtNum(optInCount) : "—"} tone="emerald" />
        <Stat label="Hidden traders" value={fmtNum(hidden.length)} hint="Buying wholesale volumes outside the desk" tone="violet" />
      </div>

      {/* Segment cards (click to filter) */}
      {segmentSummary.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {segmentSummary.map((s) => (
            <button
              key={s.segment}
              onClick={() => {
                setTab("all");
                setSegment(segment === s.segment ? "" : s.segment);
              }}
              className={`text-left bg-white rounded-xl border p-3 transition hover:shadow ${
                segment === s.segment ? "border-emerald-500 ring-2 ring-emerald-200" : "border-slate-200"
              }`}
            >
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${segClass(s.segment)}`}>{s.segment}</span>
              <div className="mt-2 text-lg font-bold text-slate-900">{fmtNum(s.count)} traders</div>
              <div className="text-xs text-slate-500">
                {s.share.toFixed(1)}% of revenue · {s.overdue} overdue
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Chart: share of traders vs share of revenue per segment */}
      {segmentSummary.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">Share of traders vs share of revenue</h2>
          <p className="text-sm text-slate-500">
            When the revenue bar is longer than the traders bar, a small group carries a big part of the money.
          </p>
          <div className="mt-4" style={{ height: 40 + segmentSummary.length * 46 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={segmentSummary.map((s) => ({
                  segment: s.segment,
                  "% of traders": +((s.count / (all.length || 1)) * 100).toFixed(1),
                  "% of revenue": +s.share.toFixed(1),
                }))}
                margin={{ left: 10, right: 40 }}
                barGap={2}
                barCategoryGap={10}
              >
                <CartesianGrid horizontal={false} stroke="#e6e0d6" />
                <XAxis type="number" unit="%" tick={{ fontSize: 11, fill: "#7d7469" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="segment" width={120} tick={{ fontSize: 12, fill: "#463f38" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "#f3efe8" }} formatter={(v) => v + "%"} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="% of traders" fill="#2a78d6" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="% of traders" position="right" formatter={(v) => v + "%"} style={{ fontSize: 11, fill: "#5e564d" }} />
                </Bar>
                <Bar dataKey="% of revenue" fill="#eb6834" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="% of revenue" position="right" formatter={(v) => v + "%"} style={{ fontSize: 11, fill: "#5e564d" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {[
          ["all", `All traders (${rows.length})`],
          ["hidden", `Hidden traders (${hidden.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "all" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center bg-white border border-slate-200 rounded-xl p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, name, governorate..."
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-64"
            />
            <select value={segment} onChange={(e) => setSegment(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All segments</option>
              {segments.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select value={gov} onChange={(e) => setGov(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All governorates</option>
              {governorates.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="revenue">Sort: revenue</option>
              <option value="orders">Sort: orders</option>
              <option value="recency">Sort: most recent</option>
              {has("overdueRatio") && <option value="overdueRatio">Sort: most overdue</option>}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
              Overdue only
            </label>
            {has("optIn") && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={optInOnly} onChange={(e) => setOptInOnly(e.target.checked)} />
                Opted-in only
              </label>
            )}
            <div className="ml-auto text-sm text-slate-500">
              {fmtNum(rows.length)} traders · {fmtEGP(filteredRevenue)}
            </div>
          </div>

          {/* Traders table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Trader</th>
                  {has("gov") && <th className="px-4 py-3 text-left font-medium">Governorate</th>}
                  {has("segment") && <th className="px-4 py-3 text-left font-medium">Segment</th>}
                  {has("revenue") && <th className="px-4 py-3 text-right font-medium">Net sales</th>}
                  {has("orders") && <th className="px-4 py-3 text-right font-medium">Orders</th>}
                  {has("recency") && <th className="px-4 py-3 text-right font-medium">Days since order</th>}
                  {has("lastOrder") && <th className="px-4 py-3 text-left font-medium">Last order</th>}
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  {has("action") && <th className="px-4 py-3 text-left font-medium">Next action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r) => {
                  const id = pick(r, F.id);
                  return (
                    <tr
                      key={id}
                      onClick={() => setSelected(id)}
                      className="border-t border-slate-100 hover:bg-emerald-50/50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{pick(r, F.name) ?? id}</div>
                        <div className="text-xs text-slate-400">{id}</div>
                      </td>
                      {has("gov") && <td className="px-4 py-3 text-slate-700">{pick(r, F.gov) ?? "—"}</td>}
                      {has("segment") && (
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${segClass(pick(r, F.segment))}`}>
                            {pick(r, F.segment) ?? "—"}
                          </span>
                        </td>
                      )}
                      {has("revenue") && <td className="px-4 py-3 text-right text-slate-900">{fmtEGP(pick(r, F.revenue))}</td>}
                      {has("orders") && <td className="px-4 py-3 text-right">{fmtNum(pick(r, F.orders))}</td>}
                      {has("recency") && <td className="px-4 py-3 text-right">{fmtNum(pick(r, F.recency))}</td>}
                      {has("lastOrder") && <td className="px-4 py-3 text-slate-600">{fmtDate(pick(r, F.lastOrder))}</td>}
                      <td className="px-4 py-3 space-x-1 whitespace-nowrap">
                        {isTrue(pick(r, F.overdue)) && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">Overdue</span>
                        )}
                        {isTrue(pick(r, F.optIn)) && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800">WhatsApp</span>
                        )}
                      </td>
                      {has("action") && <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{pick(r, F.action) ?? "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 200 && (
              <p className="text-xs text-slate-400 p-3">Showing first 200 of {fmtNum(rows.length)}. Use filters to narrow down.</p>
            )}
            {rows.length === 0 && <p className="text-sm text-slate-400 p-6">No traders match these filters.</p>}
          </div>
        </>
      )}

      {tab === "hidden" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Customers registered under retail/online who order in wholesale-like quantities. Each one is a candidate to move
            to the wholesale desk with proper terms.
          </p>
          <DataTable rows={hidden} max={100} />
        </div>
      )}

      <TraderDrawer customerId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}