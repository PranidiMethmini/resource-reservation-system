"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

const navigation = [
  { name: "Dashboard", href: "/", icon: "▦" },
  { name: "Resources", href: "/resources", icon: "▤" },
  { name: "Book Resource", href: "/book", icon: "＋" },
  { name: "My Reservations", href: "/reservations", icon: "▣" },
];

export default function Sidebar({ user }: { user: { name: string } }) {
  const pathname = usePathname();
  const [roleState, setRoleState] = useState<{ path: string; role: "ADMIN" | "USER" | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [adminToggle, setAdminToggle] = useState<{ path: string; expanded: boolean } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const logoutPending = useRef(false);
  const role = roleState?.path === pathname ? roleState.role : null;
  const roleLabel = role === "ADMIN" ? "Admin" : role === "USER" ? "User" : roleState?.path === pathname ? "Role unavailable" : "Checking role…";
  const names = user.name.trim().split(/\s+/);
  const initials = (names.length > 1 ? names[0][0] + names[names.length - 1][0] : names[0].slice(0, 2)).toLocaleUpperCase();

  useEffect(() => {
    const controller = new AbortController();
    async function checkRole() {
      try {
        const response = await fetch("/api/auth/role", { cache: "no-store", signal: controller.signal });
        const data = response.ok ? await response.json() : null;
        if (!controller.signal.aborted) {
          setRoleState({ path: pathname, role: data?.role === "ADMIN" || data?.role === "USER" ? data.role : null });
        }
      } catch {
        if (!controller.signal.aborted) setRoleState({ path: pathname, role: null });
      }
    }
    checkRole();
    return () => controller.abort();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function positionPopover() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const bounds = trigger.getBoundingClientRect();
      const width = Math.min(bounds.width, window.innerWidth - 16);
      popover.style.position = "fixed";
      popover.style.width = `${width}px`;
      popover.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`;
      popover.style.right = "auto";
      popover.style.bottom = "auto";
      popover.style.margin = "0";
      popover.style.maxHeight = `${Math.min(220, window.innerHeight - 16)}px`;
      const height = popover.offsetHeight;
      const top = bounds.top >= height + 8 ? bounds.top - height - 8 : bounds.bottom + 8;
      popover.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    }
    positionPopover();
    logoutRef.current?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !profileRef.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open]);

  async function handleSignOut() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    setLogoutError("");
    try {
      // NextAuth clears the session and performs a full navigation, clearing
      // the current tab's in-memory dashboard/router state.
      await signOut({ redirectTo: "/login" });
    } catch {
      logoutPending.current = false;
      setLoggingOut(false);
      setLogoutError("Unable to sign out. Check your connection and try again.");
    }
  }

  const menuItems = role === "ADMIN" ? navigation.filter((item) => item.href !== "/resources") : navigation;
  const adminExpanded = adminToggle?.path === pathname ? adminToggle.expanded : pathname === "/admin" || pathname.startsWith("/admin/");
  const adminLinks = [
    { name: "Overview", href: "/admin" },
    { name: "Add Resource", href: "/admin/resources/new" },
    { name: "Manage Resources", href: "/resources" },
    { name: "Manage Reservations", href: "/admin/reservations" },
  ];

  return (
    <aside aria-label="Dashboard sidebar" className="relative z-20 flex w-full shrink-0 flex-col bg-slate-900 p-5 font-sans text-white md:sticky md:top-0 md:h-dvh md:min-h-0 md:w-64 md:self-start md:p-6">
      <Link href="/" className="mb-6 inline-flex w-fit items-center gap-2 rounded-lg text-2xl font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300 md:mb-10">
        ReserveHub<span className="text-indigo-400">.</span>
      </Link>

      <nav aria-label="Dashboard navigation" className="grid grid-cols-2 gap-2 md:block md:min-h-0 md:overflow-y-auto md:space-y-2">
        {menuItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg p-3 text-sm motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${isActive ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
              <span aria-hidden="true">{item.icon}</span><span>{item.name}</span>
            </Link>
          );
        })}
        {role === "ADMIN" && <div className="col-span-2">
          <button type="button" aria-expanded={adminExpanded} aria-controls="admin-navigation" onClick={() => setAdminToggle({ path: pathname, expanded: !adminExpanded })} className="flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300">
            <span aria-hidden="true">⚙</span><span className="flex-1">Admin Panel</span>
            <svg aria-hidden="true" className={`h-3.5 w-3.5 ${adminExpanded ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m5 8 5 5 5-5" /></svg>
          </button>
          {adminExpanded && <div id="admin-navigation" className="ml-5 space-y-1 border-l border-slate-700 pl-3">
            {adminLinks.map((item) => {
              const active = pathname === item.href || (item.href === "/resources" && pathname.startsWith("/admin/resources/") && pathname !== "/admin/resources/new") || (item.href === "/admin/reservations" && pathname.startsWith("/admin/reservations/"));
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className={`block rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${active ? "bg-indigo-500/15 text-indigo-200" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}>{item.name}</Link>;
            })}
          </div>}
        </div>}
      </nav>

      <div className="mt-5 shrink-0 pt-4 md:mt-auto md:pt-5">
        <div ref={profileRef} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }} className="relative border-t border-slate-700/70 pt-4">
          <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="user-profile-panel" aria-label={`Account options for ${user.name}`} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left motion-safe:transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-100 ring-1 ring-indigo-400/25">{initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" title={user.name}>{user.name}</span>
              <span className="mt-0.5 block text-xs text-slate-400">{roleLabel}</span>
            </span>
            <svg aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m5 8 5 5 5-5" /></svg>
          </button>

          {open && (
            <div ref={popoverRef} id="user-profile-panel" aria-label="Account options" className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-[min(14rem,50dvh)] overflow-y-auto rounded-xl border border-slate-600/60 bg-slate-800 p-1.5 text-slate-100 shadow-lg">
              <div className="flex items-center justify-between gap-2 border-b border-slate-700/80 px-2.5 py-2.5">
                <p className="min-w-0 truncate text-xs font-medium" title={user.name}>{user.name}</p>
                <p className="shrink-0 text-[11px] text-slate-400">{roleLabel}</p>
              </div>
              <button ref={logoutRef} type="button" onClick={handleSignOut} disabled={loggingOut} aria-busy={loggingOut} className="mt-1 flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-200 motion-safe:transition hover:bg-slate-700/80 hover:text-red-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-300 disabled:cursor-wait disabled:opacity-60">
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H5v14h4m6-14 7 7-7 7m-5-7h12" /></svg>
                {loggingOut ? "Signing out…" : "Sign Out"}
              </button>
              {logoutError && <p role="alert" className="px-2.5 pb-2 text-xs leading-5 text-red-300">{logoutError}</p>}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
