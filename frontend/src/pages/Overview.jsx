// Overview page: the one-screen story for management (headline numbers, channel trend, segments, where to act)
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";

// ---------- Helpers ----------

const fmt = (v, d = 0) =>
  v === undefined || v === null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d });

// Compact money: 12,345,678 -> "12.3M"
const money = (v) => {
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return fmt(n);
};

const asList = (res) => (Array.isArray(res) ? res : res?.items ?? res?.data ?? []);

// Find the first column whose name matches a regex (adapts to the real column names)
const findKey = (row, re, not) => (row ? Object.keys(row).find((k) => re.test(k) && !(not && not.test(k))) : undefined);

// Format a KPI from kpis.json based on its name
function formatKpi(key, value) {
  if (typeof value !== "number") return String(value);
  const k = key.toLowerCase();
  if (/pct|share|rate|margin|ratio/.test(k)) return (Math.abs(value) <= 1 ? value * 100 : value).toFixed(1) + "%";
  if (/egp|sales|revenue|profit|value|cost/.test(k)) return money(value) + " EGP";
  return fmt(value, 1);
}

// Fixed categorical colors, assigned by channel name order (never by rank)
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

function Stat({ label, value, hint, to }) {
  const body = (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-full hover:shadow transition">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1 text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

// ---------- Page ----------

export default function Overview() {
  const [kpiRes, setKpiRes] = useState(null); // {kpis, monthly, segments}
  const [traders, setTraders] = useState([]);
  const [stock, setStock] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Each call is independent: one failing endpoint should not blank the whole page
    api.kpis().then(setKpiRes).catch((e) => setError(e.message || "Failed to load KPIs"));
    api
      .traders({ limit: 5000 })
      .catch(() => api.traders({})) // fallback if the backend caps "limit"
      .then((r) => setTraders(asList(r)))
      .catch(() => {});
    api.stock({}).then(setStock).catch(() => {});
    api.forecast().then(setForecast).catch(() => {});
  }, []);

  // ----- Monthly revenue by channel (handles long OR wide table shapes) -----
  const { chartData, channels, channelShare } = useMemo(() => {
    const rows = asList(kpiRes?.monthly);
    if (rows.length === 0) return { chartData: [], channels: [], channelShare: [] };
    const first = rows[0];
    const dateKey = findKey(first, /month|date|period/i);
    const chanKey = findKey(first, /channel/i);
    const valKey = findKey(first, /net_?sales|revenue/i, /share|pct|growth/i) ?? findKey(first, /sales|units|qty/i);

    const byMonth = {};
    let chans = [];
    if (chanKey && valKey) {
      // Long format: Month | Channel | Net_Sales_EGP
      for (const r of rows) {
        const m = String(r[dateKey]).slice(0, 7);
        byMonth[m] ??= { month: m };
        byMonth[m][r[chanKey]] = (byMonth[m][r[chanKey]] ?? 0) + Number(r[valKey] || 0);
      }
      chans = [...new Set(rows.map((r) => r[chanKey]))].sort();
    } else {
      // Wide format: Month | Wholesale | Retail | Online ...
      chans = Object.keys(first).filter((k) => k !== dateKey && typeof first[k] === "number");
      for (const r of rows) {
        const m = String(r[dateKey]).slice(0, 7);
        byMonth[m] = { month: m, ...Object.fromEntries(chans.map((c) => [c, r[c]])) };
      }
    }
    const data = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    const totals = chans.map((c) => ({ channel: c, total: data.reduce((s, r) => s + (r[c] || 0), 0) }));
    const grand = totals.reduce((s, t) => s + t.total, 0);
    return {
      chartData: data,
      channels: chans,
      channelShare: totals.map((t) => ({ ...t, share: grand ? (t.total / grand) * 100 : 0 })).sort((a, b) => b.total - a.total),
    };
  }, [kpiRes]);

  // ----- Live numbers computed from the other endpoints -----
  const live = useMemo(() => {
    const revKey = findKey(traders[0], /net_?sales|revenue|monetary/i, /share|pct|ratio|trend|avg|per_|score|rank/i);
    const segKey = findKey(traders[0], /segment/i);
    const odKey = findKey(traders[0], /overdue_flag|is_overdue/i);
    const isTrue = (v) => v === true || v === 1 || String(v).toLowerCase() === "true";
    const total = traders.reduce((s, r) => s + (Number(r[revKey]) || 0), 0);
    const atRisk = traders.filter((r) => r[segKey] === "At Risk");
    const atRiskRev = atRisk.reduce((s, r) => s + (Number(r[revKey]) || 0), 0);

    const items = stock?.items ?? [];
    const desk = items.filter((r) => r.Location_Short === "Wholesale Desk");
    const deskShort = desk.filter((r) => ["Out of stock", "Reorder now", "Low"].includes(r.Stock_Status)).length;

    return {
      traders: traders.length,
      overdue: odKey ? traders.filter((r) => isTrue(r[odKey])).length : null,
      atRiskCount: atRisk.length,
      atRiskShare: total ? (atRiskRev / total) * 100 : null,
      deskShort,
      deskTotal: desk.length,
      f90: forecast?.totals?.Forecast_90d,
      produce: forecast?.totals?.Plan_To_Produce,
    };
  }, [traders, stock, forecast]);

  // ----- Flatten kpis.json into tiles (nested objects one level deep) -----
  const kpiTiles = useMemo(() => {
    const out = [];
    const walk = (obj, prefix = "") => {
      for (const [k, v] of Object.entries(obj ?? {})) {
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, prefix + k + " · ");
        else if (typeof v === "number" || typeof v === "string") out.push({ key: prefix + k, raw: k, value: v });
      }
    };
    walk(kpiRes?.kpis);
    return out;
  }, [kpiRes]);

  const segments = asList(kpiRes?.segments);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
        <p className="text-slate-500 mt-1">LEO MODA wholesale at a glance: who brings the money, who is slipping, and what stock to fix.</p>
      </div>

      {error && <p className="text-red-600 text-sm">{error} · make sure the backend is running on port 8000.</p>}

      {/* Headline: the story in 4 numbers, each links to the page where you act on it */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="At-risk traders"
          value={fmt(live.atRiskCount)}
          hint={live.atRiskShare != null ? `${live.atRiskShare.toFixed(1)}% of wholesale revenue → call them first` : ""}
          to="/traders"
        />
        <Stat label="Overdue traders" value={fmt(live.overdue)} hint={`of ${fmt(live.traders)} traders · gap ≥ 2× usual cycle`} to="/traders" />
        <Stat
          label="Desk short on"
          value={live.deskTotal ? `${live.deskShort} / ${live.deskTotal}` : "—"}
          hint="products at the Wholesale Desk → rebalance from stores"
          to="/stock"
        />
        <Stat label="Demand next 90 days" value={fmt(live.f90)} hint={`units · plan to produce ${fmt(live.produce)}`} to="/stock" />
      </div>

      {/* Key findings from the analysis notebook */}
      <section className="bg-slate-900 text-slate-100 rounded-xl p-6">
        <h2 className="font-semibold text-emerald-300">What the data says</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed list-disc pl-5">
          <li><b>Wholesale is the business:</b> about 5.5% of customers (the traders) bring ~85% of revenue and ~66% of profit.</li>
          <li><b>The margin leak is the discount:</b> wholesale margin is ~12% vs 35–37% in retail because every trader gets the same ~33% discount. Each 1 point of discount ≈ 5.3M EGP of profit.</li>
          <li><b>Revenue at risk:</b> 371 traders who used to buy often have gone quiet, and they hold ~34% of wholesale revenue.</li>
          <li><b>Stock is in the wrong place:</b> the Wholesale Desk is short on most products while stores are overstocked → move before producing.</li>
          <li><b>Honest limits:</b> a churn model was tested and rejected (AUC ≈ 0.5, no better than chance), so “at risk” is a description, not a prediction. CSAT does not change with wait time, so the bot’s value is workload and 24/7 availability.</li>
        </ul>
      </section>

      <div className="grid xl:grid-cols-3 gap-6">
        {/* Monthly trend */}
        <section className="xl:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">Monthly net sales by channel</h2>
          <p className="text-sm text-slate-500">EGP · seasonal peak in July, low in February</p>
          <div className="h-72 mt-4">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={money} />
                  <Tooltip formatter={(v) => fmt(v) + " EGP"} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {channels.map((c, i) => (
                    <Line key={c} type="monotone" dataKey={c} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400">No monthly data.</p>
            )}
          </div>
        </section>

        {/* Channel share */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">Share of net sales</h2>
          <p className="text-sm text-slate-500">Whole period, by channel</p>
          <div className="mt-4 space-y-4">
            {channelShare.map((c) => (
              <div key={c.channel}>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-800">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: SERIES_COLORS[channels.indexOf(c.channel) % SERIES_COLORS.length] }} />
                    {c.channel}
                  </span>
                  <span className="text-slate-600">{c.share.toFixed(1)}% · {money(c.total)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full mt-1 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${c.share}%`, background: SERIES_COLORS[channels.indexOf(c.channel) % SERIES_COLORS.length] }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* All KPIs from kpis.json */}
      {kpiTiles.length > 0 && (
        <section>
          <h2 className="font-semibold text-slate-900 mb-3">All KPIs</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {kpiTiles.map((t) => (
              <div key={t.key} className="bg-white rounded-lg border border-slate-200 p-3">
                <div className="text-xs text-slate-500">{t.key.replaceAll("_", " ")}</div>
                <div className="text-lg font-semibold text-slate-900 mt-0.5">{formatKpi(t.raw, t.value)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Segment summary table */}
      {segments.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-3">Trader segments</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {Object.keys(segments[0]).map((c) => (
                    <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c.replaceAll("_", " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segments.map((s, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {Object.entries(s).map(([k, v]) => (
                      <td key={k} className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {typeof v === "number" ? formatKpi(k, v) : String(v ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}