// All calls to the FastAPI backend live here (one place to change if the API changes)

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

// Remove empty filters before building "?a=1&b=2"
function query(params = {}) {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return new URLSearchParams(clean).toString();
}

export const api = {
  kpis:          ()            => request("/api/kpis"),
  traders:       (params = {}) => request(`/api/traders?${query(params)}`),
  trader:        (id)          => request(`/api/traders/${id}`),
  hiddenTraders: (limit = 20)  => request(`/api/hidden-traders?limit=${limit}`),
  products:      (params = {}) => request(`/api/products?${query(params)}`),
  product:       (id)          => request(`/api/products/${id}`),
  stock:         (params = {}) => request(`/api/stock?${query(params)}`),
  forecast:      ()            => request("/api/forecast"),
  chat:          (body)        => request("/api/chat", { method: "POST", body: JSON.stringify(body) }),
  resetChat:     (sessionId)   => request(`/api/chat/reset?session_id=${encodeURIComponent(sessionId)}`, { method: "POST" }),
  botOrders:     ()            => request("/api/bot/orders"),
  demandSignals: ()            => request("/api/bot/demand-signals"),
};