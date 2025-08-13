"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

export function TopNav() {
  const [user, setUser] = useState<{ sub: string; email: string } | null>(null);
  const [familyName, setFamilyName] = useState<string | null>(null);
  const pathname = usePathname();
  const onAuth = pathname === '/login' || pathname === '/signup';
  const onHomeLoggedOut = !user && pathname === '/';

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ user: { sub: string; email: string } }>("/auth/me");
        setUser(res.user);
      } catch {}
      try {
  const path = pathname || '';
  const m = path.match(/^\/families\/([^\/]+)\/(tree|chat)/);
        const fid = m?.[1];
        if (fid) {
          const list = await api<{ families: Array<{ id: string; name: string }> }>("/families");
          const f = list.families.find((x) => x.id === fid);
          if (f) setFamilyName(f.name);
          else setFamilyName(null);
        } else {
          setFamilyName(null);
        }
      } catch {}
    })();
  }, [pathname]);

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
  window.location.href = "/";
    } catch {}
  }

  // Hide navbar entirely on auth pages
  if (onAuth) {
    return null;
  }

  // Hide navbar on the home page before authentication
  if (onHomeLoggedOut) {
    return null;
  }

  // Minimal header before authentication: show only brand, no navigation
  if (!user) {
    return (
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between">
          <a href="/" className="text-sm font-semibold tracking-tight text-slate-900">Family Tree</a>
          {/* Intentionally empty when logged out */}
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <a href="/" className="text-sm font-semibold tracking-tight text-slate-900">Family Tree</a>
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            {/* Home hidden when authenticated */}
            {!onAuth && (
              <>
                <a
                  className={`px-2 py-1 rounded-md transition-colors ${pathname?.startsWith('/families') ? 'text-indigo-600 bg-indigo-50' : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'}`}
                  href="/families"
                >Families</a>
                <a
                  className={`px-2 py-1 rounded-md transition-colors ${pathname === '/profile' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'}`}
                  href="/profile"
                >Profile</a>
                <a
                  className={`px-2 py-1 rounded-md transition-colors ${pathname?.includes('/chat') ? 'text-indigo-600 bg-indigo-50' : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'}`}
                  href={((): string => {
                    const m = (pathname || '').match(/^\/families\/([^\/]+)\/(tree|chat)/);
                    const fid = m?.[1];
                    return fid ? `/families/${fid}/chat` : '/families';
                  })()}
                >Chat</a>
              </>
            )}
          </nav>
        </div>
        <div className="text-sm flex items-center gap-3">
          {familyName && <span className="px-2 py-0.5 text-xs rounded bg-indigo-50 text-indigo-700 border border-indigo-200">{familyName}</span>}
        {user ? (
          <>
              <span className="text-slate-600">{user.email}</span>
              <button className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700" onClick={logout}>Logout</button>
          </>
        ) : (
          <>
              {!(pathname === '/signup') && <a className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700" href="/signup">Sign up</a>}
              {!(pathname === '/login') && <a className="px-3 py-1 rounded-md border border-slate-300 bg-white text-slate-800 hover:bg-slate-50" href="/login">Log in</a>}
          </>
        )}
        </div>
      </div>
    </header>
  );
}
