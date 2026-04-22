import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import {
  LayoutDashboard, Search, Target, Bot, Settings, LogOut,
  ChevronLeft, ChevronRight, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const NAV = [
  { label: "Dashboard", page: "Dashboard", icon: LayoutDashboard },
  { label: "Campagnes", page: "Campaigns", icon: Search },
  { label: "Suivi", page: "Pipeline", icon: Target },
  { label: "Assistant IA", page: "Assistant", icon: Bot },
];

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => base44.auth.redirectToLogin());
  }, []);

  const navItems = user?.role === "admin"
    ? [...NAV, { label: "Admin", page: "Admin", icon: Settings }]
    : NAV;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#050505' }}>
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col flex-shrink-0 transition-all duration-200",
          collapsed ? "w-14" : "w-52"
        )}
        style={{
          background: '#0a0a0a',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center gap-2 h-14 px-4 flex-shrink-0",
            collapsed && "justify-center px-0"
          )}
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Zap className="w-5 h-5 flex-shrink-0" style={{ color: '#007BFF' }} />
          {!collapsed && (
            <span className="font-semibold text-sm tracking-widest uppercase" style={{ color: '#ffffff', letterSpacing: '0.15em' }}>
              Prospect
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ label, page, icon: Icon }) => {
            const isActive = currentPageName === page;
            return (
              <Link
                key={page}
                to={createPageUrl(page)}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                  collapsed && "justify-center px-2",
                  isActive ? "nav-active" : "text-[#606060] hover:text-[#D8D8D8] hover:bg-white/5"
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-2 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {!collapsed && user && (
            <div className="px-3 py-2 rounded-lg mb-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-xs font-medium truncate" style={{ color: '#D8D8D8' }}>
                {user.full_name || user.email}
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#505050' }}>
                {user.role === "admin" ? "Administrateur" : "Commercial"}
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg w-full text-xs transition-colors hover:bg-white/5"
            style={{ color: '#505050' }}
          >
            {collapsed
              ? <ChevronRight className="w-4 h-4 mx-auto" />
              : <><ChevronLeft className="w-4 h-4" /><span>Réduire</span></>
            }
          </button>
          <button
            onClick={() => base44.auth.logout()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg w-full text-xs transition-colors hover:bg-white/5"
            style={{ color: '#505050' }}
            onMouseEnter={e => e.currentTarget.style.color = '#FF3B30'}
            onMouseLeave={e => e.currentTarget.style.color = '#505050'}
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span>Déconnexion</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto" style={{ background: '#050505' }}>
        {children}
      </main>

      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}