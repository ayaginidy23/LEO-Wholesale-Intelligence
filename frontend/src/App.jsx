// App shell: brand sidebar (leo.moda logo) + page routes
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import Chat from "./pages/Chat.jsx";
import Traders from "./pages/Traders.jsx";
import Stock from "./pages/Stock.jsx";
import Overview from "./pages/Overview.jsx";

// Sidebar links: path, label, icon
const NAV = [
  { to: "/overview", label: "Overview", icon: "📊" },
  { to: "/traders", label: "Traders", icon: "👥" },
  { to: "/stock", label: "Stock & Forecast", icon: "📦" },
  { to: "/chat", label: "Wholesale Chat", icon: "💬" },
];

export default function App() {
  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar on cream, same background as the logo so it blends in */}
      <aside className="w-64 shrink-0 flex flex-col bg-brand-cream border-r border-slate-200">
        <div className="px-6 pt-6 pb-5 border-b border-slate-200">
          {/* Logo file lives in frontend/public/leo-logo.png */}
          <img src="/leo-logo.png" alt="leo.moda" className="h-12 w-auto -ml-2" />
          <div className="mt-2 text-sm font-semibold text-slate-900">Wholesale Intelligence</div>
          <div className="text-xs text-slate-500">El-Sharnouby Group</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive ? "bg-brand-ink text-brand-cream" : "text-slate-700 hover:bg-slate-100"
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Page area scrolls independently of the sidebar */}
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/traders" element={<Traders />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}