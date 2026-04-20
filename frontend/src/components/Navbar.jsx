import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Home, Sliders, History, Info, LogOut, User, Settings,
  BarChart2, FlaskConical, Bell, X, TrendingUp,
} from "lucide-react";
import { useAuth }        from "../context/AuthContext";
import { fetchHistory, fetchYieldReports } from "../lib/api";
import { generateNotifications, generateDriftNotifications, getReadIds, markAsRead } from "../lib/notifications";
const NAV = [
  { to: "/",         label: "Dashboard", icon: Home        },
  { to: "/ranker",   label: "What-If",   icon: FlaskConical },
  { to: "/models",   label: "Models",    icon: Sliders     },
  { to: "/history",  label: "History",   icon: History     },
  { to: "/settings", label: "Settings",  icon: Settings    },
  { to: "/about",    label: "About",     icon: Info        },
];

const TYPE_META = {
  pending_harvest: {
    pillBg:  "bg-amber-50",
    pillBorder: "border-amber-200",
    pillText:   "text-amber-700",
    dot:        "bg-amber-400",
  },
  planting_window: {
    pillBg:  "bg-emerald-50",
    pillBorder: "border-emerald-200",
    pillText:   "text-emerald-700",
    dot:        "bg-emerald-400",
  },
  drift_alert: {
    pillBg:     "bg-red-50",
    pillBorder: "border-red-200",
    pillText:   "text-red-700",
    dot:        "bg-red-500",
  },
};

const ICON_MAP = {
  chart:    <TrendingUp size={15} className="text-amber-500 shrink-0 mt-0.5" />,
  seedling: <span className="text-base leading-none mt-0.5">🌱</span>,
  drift:    <span className="text-base leading-none mt-0.5">⚠️</span>,
};

function NotificationBell({ userId }) {
  const [open,    setOpen]    = useState(false);
  const [notifs,  setNotifs]  = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  const [loaded,  setLoaded]  = useState(false);
  const panelRef  = useRef(null);
  const navigate  = useNavigate();

  const { profile } = useAuth();
  const isAdmin     = profile?.role === "admin";

  useEffect(() => {
    if (!userId) return;
    const historyPromise = fetchHistory()
      .then(data => Array.isArray(data) ? data : (data.recommendations ?? []));
    const driftPromise = isAdmin
      ? fetchYieldReports().catch(() => null)
      : Promise.resolve(null);

    Promise.all([historyPromise, driftPromise])
      .then(([recs, yieldData]) => {
        const base  = generateNotifications(recs);
        const drift = yieldData ? generateDriftNotifications(yieldData) : [];
        setNotifs([...drift, ...base]);
        setReadIds(getReadIds(userId));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [userId, isAdmin]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const unread = notifs.filter(n => !readIds.has(n.id)).length;

  function handleMarkAll() {
    const ids = notifs.map(n => n.id);
    markAsRead(userId, ids);
    setReadIds(new Set(ids));
  }

  function handleDismiss(id) {
    markAsRead(userId, [id]);
    setReadIds(prev => new Set([...prev, id]));
  }

  function handleAction(n) {
    handleDismiss(n.id);
    setOpen(false);
    navigate(n.link);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-md text-slate-500 hover:bg-slate-50
                   hover:text-slate-700 transition"
        title="Notifications"
      >
        <Bell size={18} />
        {loaded && unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5
                           bg-red-500 text-white text-[9px] font-bold rounded-full
                           flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200
                        rounded-xl shadow-xl z-50 overflow-hidden">

          <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
            <div className="flex items-center gap-2">
              <Bell size={13} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-800">Notifications</span>
              {unread > 0 && (
                <span className="text-[10px] font-bold bg-red-100 text-red-600
                                 px-1.5 py-0.5 rounded-full">
                  {unread} new
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={handleMarkAll}
                className="text-[11px] text-blue-600 hover:text-blue-800 underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {!loaded && (
              <div className="px-4 py-8 text-center text-sm text-slate-300 animate-pulse">
                Loading...
              </div>
            )}

            {loaded && notifs.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Bell size={22} className="text-slate-200 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-400">No notifications</p>
                <p className="text-[11px] text-slate-300 mt-1">
                  Alerts appear when harvest reports are overdue or a planting window is approaching.
                </p>
              </div>
            )}

            {loaded && notifs.map(n => {
              const isRead = readIds.has(n.id);
              const meta   = TYPE_META[n.type] ?? TYPE_META.planting_window;
              return (
                <div
                  key={n.id}
                  className={`px-4 py-3 transition hover:bg-slate-50/80
                              ${isRead ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start gap-2.5">
                    {ICON_MAP[n.icon] ?? <Bell size={14} className="text-slate-400 mt-0.5" />}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <p className={`text-[11px] leading-snug text-slate-800
                                       ${!isRead ? "font-semibold" : "font-medium"}`}>
                          {n.title}
                        </p>
                        <button
                          onClick={() => handleDismiss(n.id)}
                          className="text-slate-200 hover:text-slate-500 transition shrink-0 mt-0.5"
                          title="Dismiss"
                        >
                          <X size={11} />
                        </button>
                      </div>

                      <p className="text-[10px] text-slate-500 leading-relaxed mb-1.5">
                        {n.body}
                      </p>

                      <button
                        onClick={() => handleAction(n)}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-md
                                    border transition ${meta.pillBg} ${meta.pillBorder}
                                    ${meta.pillText} hover:opacity-80`}
                      >
                        {n.linkLabel} →
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {loaded && notifs.length > 0 && (
            <div className="px-4 py-2.5 border-t bg-slate-50">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Generated from your advisory history.
                Dismissed notifications are remembered in your browser.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { pathname }               = useLocation();
  const { user, profile, signOut } = useAuth();

  const allLinks = profile?.role === "admin"
    ? [...NAV, { to: "/admin", label: "Analytics", icon: BarChart2 }]
    : NAV;

  return (
    <header className="bg-white border-b">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <Link to="/" className="font-semibold text-lg text-slate-900 flex items-center gap-2">
          CropAdvisor
          {profile?.role === "admin" && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5
                             rounded-full font-medium">
              Admin
            </span>
          )}
        </Link>

        <nav className="flex items-center gap-1">
          {allLinks.map(({ to, label, icon }) => {
            const Icon = icon;
            return (
              <Link key={to} to={to}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition
                  ${pathname === to
                    ? to === "/admin"
                      ? "bg-purple-50 text-purple-700 font-medium"
                      : "bg-slate-100 font-medium"
                    : to === "/admin"
                      ? "text-purple-600 hover:bg-purple-50"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}>
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}

          <NotificationBell userId={user?.id} />

          <div className="ml-2 pl-2 border-l flex items-center gap-2">
            <span className="hidden md:flex items-center gap-1.5 text-xs text-slate-500">
              <User size={14} />
              {user?.email?.split("@")[0]}
            </span>
            <button onClick={signOut}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-600
                         px-2 py-2 rounded-md hover:bg-red-50 transition"
              title="Sign out">
              <LogOut size={16} />
              <span className="hidden sm:inline text-xs">Sign out</span>
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
