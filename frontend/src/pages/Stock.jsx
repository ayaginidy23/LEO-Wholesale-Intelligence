// Stock & Forecast page: stock health per location, rebalance suggestions, 30/60/90 forecast, production plan
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.js";

// ---------- Constants ----------

// Status colors (reserved status palette) + icon so color never carries meaning alone
const STATUS = {
  "Out of stock": { color: "#d03b3b", icon: "⛔", badge: "bg-red-100 text-red-800" },
  "Reorder now": { color: "#ec835a", icon: "⚠️", badge: "bg-orange-100 text-orange-800" },
  Low: { color: "#fab219", icon: "▼", badge: "bg-amber-100 text-amber-800" },
  Healthy: { color: "#0ca30c", icon: "✓", badge: "bg-green-100 text-green-800" },
  Overstock: { color: "#2a78d6", icon: "▲", badge: "bg-blue-100 text-blue-800" },
};
const STATUS_ORDER = ["Out of stock", "Reorder now", "Low", "Healthy", "Overstock"];
const SHORT_STATUSES = ["Out of stock", "Reorder now", "Low"];

const DESK = "Wholesale Desk"; // Location_Short of LOC003
const DESK_TARGET_DAYS = 45; // rebalance rule: desk should hold ~45 days of its own sales
const STORE_KEEP_DAYS = 60; // rebalance rule: a store keeps ~60 days, anything above is movable

// ---------- Helpers ----------

const fmt = (v, d = 0) =>
  v === undefined || v === null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d });

function Stat({ label, value, hint }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1 text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? { icon: "", badge: "bg-slate-100 text-slate-700" };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s.badge}`}>
      {s.icon} {status}
    </span>
  );
}

function Card({ title, subtitle, children, right }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// ---------- Page ----------

export default function Stock() {
  const [stock, setStock] = useState(null); // {total, summary, items}
  const [forecast, setForecast] = useState(null); // {totals, items}
  const [error, setError] = useState("");

  const [locFilter, setLocFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [audience, setAudience] = useState("");
  const [season, setSeason] = useState("");

  useEffect(() => {
    Promise.all([api.stock({}), api.forecast()])
      .then(([s, f]) => {
        setStock(s);
        setForecast(f);
      })
      .catch((e) => setError(e.message || "Failed to load stock data"));
  }, []);

  const stockItems = stock?.items ?? [];
  const fcItems = forecast?.items ?? [];
  const totals = forecast?.totals ?? {};

  // Product names live in the forecast file; build a lookup for the stock table
  const productInfo = useMemo(() => {
    const m = {};
    for (const p of fcItems) m[p.Product_ID] = p;
    return m;
  }, [fcItems]);
  const pname = (id) => productInfo[id]?.Product_Name ?? id;

  const locations = useMemo(() => [...new Set(stockItems.map((r) => r.Location_Short))].sort(), [stockItems]);

  // Chart data: one row per location, one key per status = number of products
  const statusChart = useMemo(() => {
    const rows = {};
    for (const s of stock?.summary ?? []) {
      rows[s.Location_Short] ??= { location: s.Location_Short };
      rows[s.Location_Short][s.Stock_Status] = s.Products;
    }
    return Object.values(rows);
  }, [stock]);

  // Headline: how many products are short at the desk while a store is overstocked
  const deskShort = stockItems.filter((r) => r.Location_Short === DESK && SHORT_STATUSES.includes(r.Stock_Status));
  const deskProducts = stockItems.filter((r) => r.Location_Short === DESK).length;
  const storeOverstock = stockItems.filter((r) => r.Location_Short !== DESK && r.Stock_Status === "Overstock").length;

  // Rebalance suggestions: move units from overstocked stores to the short wholesale desk
  const rebalance = useMemo(() => {
    const out = [];
    for (const d of stockItems.filter((r) => r.Location_Short === DESK && SHORT_STATUSES.includes(r.Stock_Status))) {
      const need = Math.max(0, Math.round(d.Avg_Daily_Sales_90D * DESK_TARGET_DAYS - d.Closing_Stock));
      if (need <= 0) continue;
      // Candidate donor stores for the same product, largest surplus first
      const donors = stockItems
        .filter((r) => r.Product_ID === d.Product_ID && r.Location_Short !== DESK)
        .map((r) => ({ ...r, surplus: Math.floor(r.Closing_Stock - r.Avg_Daily_Sales_90D * STORE_KEEP_DAYS) }))
        .filter((r) => r.surplus > 0)
        .sort((a, b) => b.surplus - a.surplus);
      let remaining = need;
      for (const s of donors) {
        if (remaining <= 0) break;
        const qty = Math.min(remaining, s.surplus);
        out.push({
          Product_ID: d.Product_ID,
          from: s.Location_Short,
          qty,
          deskStock: d.Closing_Stock,
          deskStatus: d.Stock_Status,
          need,
        });
        remaining -= qty;
      }
    }
    return out.sort((a, b) => b.qty - a.qty);
  }, [stockItems]);
  const rebalanceUnits = rebalance.reduce((s, r) => s + r.qty, 0);
  const rebalanceProducts = new Set(rebalance.map((r) => r.Product_ID)).size;

  // Forecast vs stock chart: top 12 products by 90-day demand
  const fcChart = useMemo(
    () =>
      [...fcItems]
        .sort((a, b) => b.Forecast_90d - a.Forecast_90d)
        .slice(0, 12)
        .map((p) => ({
          name: p.Product_ID,
          label: p.Product_Name,
          "Forecast 90d": p.Forecast_90d,
          "Stock now": p.Stock_Now,
        })),
    [fcItems]
  );

  const audiences = [...new Set(fcItems.map((p) => p.Audience).filter(Boolean))].sort();
  const seasons = [...new Set(fcItems.map((p) => p.Season).filter(Boolean))].sort();

  const plan = fcItems
    .filter((p) => (!audience || p.Audience === audience) && (!season || p.Season === season))
    .sort((a, b) => (b.Plan_To_Produce ?? 0) - (a.Plan_To_Produce ?? 0));

  // Overstock list: biggest piles of stock across all locations, by product
  const overstockByProduct = useMemo(() => {
    const m = {};
    for (const r of stockItems) {
      m[r.Product_ID] ??= { Product_ID: r.Product_ID, stock: 0, daily: 0 };
      m[r.Product_ID].stock += r.Closing_Stock;
      m[r.Product_ID].daily += r.Avg_Daily_Sales_90D;
    }
    const total = Object.values(m).reduce((s, x) => s + x.stock, 0);
    return Object.values(m)
      .map((x) => ({ ...x, share: total ? (x.stock / total) * 100 : 0, cover: x.daily ? x.stock / x.daily : null }))
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 6);
  }, [stockItems]);

  const stockTable = stockItems
    .filter((r) => (!locFilter || r.Location_Short === locFilter) && (!statusFilter || r.Stock_Status === statusFilter))
    .sort((a, b) => STATUS_ORDER.indexOf(a.Stock_Status) - STATUS_ORDER.indexOf(b.Stock_Status) || a.Days_of_Cover - b.Days_of_Cover);

  if (error)
    return (
      <div className="p-8">
        <p className="text-red-600">{error}</p>
        <p className="text-slate-500 text-sm mt-2">Make sure the backend is running on port 8000.</p>
      </div>
    );
  if (!stock || !forecast) return <div className="p-8 text-slate-500">Loading stock & forecast...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Stock & Forecast</h1>
        <p className="text-slate-500 mt-1">
          Where the stock is, what will sell in the next 90 days, and what to move or produce first.
        </p>
      </div>

      {/* Forecast KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat label="Demand next 30 days" value={fmt(totals.Forecast_30d)} hint="units, seasonal forecast" />
        <Stat label="Next 60 days" value={fmt(totals.Forecast_60d)} hint="units" />
        <Stat label="Next 90 days" value={fmt(totals.Forecast_90d)} hint="units" />
        <Stat label="Stock now" value={fmt(totals.Stock_Now)} hint="units, all locations" />
        <Stat label="Plan to produce" value={fmt(totals.Plan_To_Produce)} hint="units to cover 90d + safety" />
      </div>

      {/* Key insight */}
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
        <div className="font-semibold text-amber-900">
          Rebalance before producing: the Wholesale Desk is short on {deskShort.length} of {deskProducts} products
          while stores hold {storeOverstock} overstocked product lines.
        </div>
        <p className="text-sm text-amber-800 mt-1">
          Moving about <b>{fmt(rebalanceUnits)}</b> units across <b>{rebalanceProducts}</b> products from stores to the
          desk covers part of the gap with zero production cost. Rule used: the desk targets {DESK_TARGET_DAYS} days of its
          own sales; a store keeps {STORE_KEEP_DAYS} days and only the surplus above that is moved.
        </p>
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        {/* Stock health per location */}
        <Card title="Stock health by location" subtitle="Number of products in each status (from 90-day sales and days of cover)">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChart} layout="vertical" margin={{ left: 20, right: 16 }} barCategoryGap={14}>
                <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="location" width={110} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {STATUS_ORDER.map((s) => (
                  <Bar key={s} dataKey={s} name={`${STATUS[s].icon} ${s}`} stackId="a" fill={STATUS[s].color} stroke="#fff" strokeWidth={2} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Forecast vs stock */}
        <Card title="Top 12 products: 90-day demand vs stock now" subtitle="Where the bar for demand is taller than stock, production or transfer is needed">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fcChart} margin={{ left: 0, right: 8 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  labelFormatter={(id, p) => p?.[0]?.payload?.label ?? id}
                  formatter={(v) => fmt(v)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Forecast 90d" fill="#2a78d6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Stock now" fill="#eb6834" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        {/* Rebalance table */}
        <Card title="Suggested transfers to the Wholesale Desk" subtitle={`${rebalance.length} moves · ${fmt(rebalanceUnits)} units`}>
          <div className="max-h-80 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">From</th>
                  <th className="px-3 py-2 text-right font-medium">Move</th>
                  <th className="px-3 py-2 text-right font-medium">Desk stock</th>
                  <th className="px-3 py-2 text-left font-medium">Desk status</th>
                </tr>
              </thead>
              <tbody>
                {rebalance.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="text-slate-900">{pname(r.Product_ID)}</div>
                      <div className="text-xs text-slate-400">{r.Product_ID}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.from}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{fmt(r.qty)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{fmt(r.deskStock)}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.deskStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rebalance.length === 0 && <p className="text-sm text-slate-400 p-4">No transfers needed.</p>}
          </div>
        </Card>

        {/* Overstock concentration */}
        <Card title="Where the stock is piling up" subtitle="Products holding the biggest share of total stock (all locations)">
          <div className="space-y-3">
            {overstockByProduct.map((p) => (
              <div key={p.Product_ID}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-800">
                    {pname(p.Product_ID)} <span className="text-slate-400">· {p.Product_ID}</span>
                  </span>
                  <span className="text-slate-600">
                    {fmt(p.stock)} units · {p.share.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-[#2a78d6] rounded-full" style={{ width: `${Math.min(100, p.share * 2)}%` }} />
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  ≈ {p.cover ? fmt(p.cover) : "—"} days of cover at current sales → clearance candidate for the bot
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Production plan */}
      <Card
        title="Production plan (next 90 days)"
        subtitle="Net need = 90-day forecast − stock now. Lead time ≈ 16 days, so start with the lowest days of cover."
        right={
          <div className="flex gap-2">
            <select value={audience} onChange={(e) => setAudience(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="">All audiences</option>
              {audiences.map((a) => <option key={a}>{a}</option>)}
            </select>
            <select value={season} onChange={(e) => setSeason(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="">All seasons</option>
              {seasons.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        }
      >
        <div className="max-h-96 overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Product</th>
                <th className="px-3 py-2 text-left font-medium">Audience</th>
                <th className="px-3 py-2 text-left font-medium">Season</th>
                <th className="px-3 py-2 text-right font-medium">30d</th>
                <th className="px-3 py-2 text-right font-medium">60d</th>
                <th className="px-3 py-2 text-right font-medium">90d</th>
                <th className="px-3 py-2 text-right font-medium">Stock now</th>
                <th className="px-3 py-2 text-right font-medium">Days cover</th>
                <th className="px-3 py-2 text-right font-medium">Produce</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.Product_ID} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="text-slate-900">{p.Product_Name}</div>
                    <div className="text-xs text-slate-400">{p.Product_ID} · {p.Product_Family}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.Audience}</td>
                  <td className="px-3 py-2 text-slate-600">{p.Season}</td>
                  <td className="px-3 py-2 text-right">{fmt(p.Forecast_30d)}</td>
                  <td className="px-3 py-2 text-right">{fmt(p.Forecast_60d)}</td>
                  <td className="px-3 py-2 text-right">{fmt(p.Forecast_90d)}</td>
                  <td className="px-3 py-2 text-right">{fmt(p.Stock_Now)}</td>
                  <td className={`px-3 py-2 text-right ${p.Days_Cover_Forecast < 16 ? "text-red-700 font-semibold" : "text-slate-700"}`}>
                    {fmt(p.Days_Cover_Forecast)}
                    {p.Days_Cover_Forecast < 16 && " ⚠️"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">{p.Plan_To_Produce > 0 ? fmt(p.Plan_To_Produce) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2">⚠️ = stock runs out before a new production run (≈16 days) can arrive.</p>
      </Card>

      {/* Full stock table */}
      <Card
        title="Stock by location"
        subtitle={`${stockTable.length} product-location rows`}
        right={
          <div className="flex gap-2">
            <select value={locFilter} onChange={(e) => setLocFilter(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="">All locations</option>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="">All statuses</option>
              {STATUS_ORDER.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        }
      >
        <div className="max-h-96 overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Product</th>
                <th className="px-3 py-2 text-left font-medium">Location</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Avg daily sales</th>
                <th className="px-3 py-2 text-right font-medium">Days of cover</th>
                <th className="px-3 py-2 text-right font-medium">Reorder point</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {stockTable.map((r) => (
                <tr key={`${r.Location_ID}-${r.Product_ID}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="text-slate-900">{pname(r.Product_ID)}</div>
                    <div className="text-xs text-slate-400">{r.Product_ID}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.Location_Short}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.Closing_Stock)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.Avg_Daily_Sales_90D, 2)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.Days_of_Cover, 1)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.Reorder_Point_Units)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.Stock_Status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}