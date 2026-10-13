import Link from "next/link";
import type { ReactNode } from "react";

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" aria-label="ReserveHub home" className={`inline-flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 ${light ? "text-white focus-visible:outline-white" : "text-slate-900 focus-visible:outline-indigo-600"}`}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-sm ${light ? "bg-white/15 ring-1 ring-white/25" : "bg-indigo-600 text-white"}`}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="5" width="16" height="16" rx="3" />
          <path d="M8 3v4M16 3v4M4 11h16m-12 5 2 2 5-5" />
        </svg>
      </span>
      <span className="text-xl font-bold tracking-tight">ReserveHub<span className={light ? "text-indigo-300" : "text-indigo-600"}>.</span></span>
    </Link>
  );
}

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50 font-sans text-slate-900 lg:grid lg:h-dvh lg:min-h-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <aside className="relative hidden min-h-0 min-w-0 overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-20 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-20 h-80 w-80 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="relative"><Brand light /></div>

        <div className="relative my-auto max-w-lg py-14">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-white/5 px-3 py-1.5 text-xs font-medium tracking-wide text-indigo-100">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-300" /> RESOURCE RESERVATIONS, SIMPLIFIED
          </p>
          <h2 className="text-4xl font-semibold leading-[1.15] tracking-tight xl:text-5xl">
            Make room for<br />your next <span className="text-indigo-300">great idea.</span>
          </h2>
          <p className="mt-6 max-w-sm text-base leading-7 text-slate-300">
            Find the right space or resource, reserve your time, and keep every booking in one place.
          </p>

          <div className="mt-10 rounded-2xl border border-white/15 bg-white/[0.06] p-6 shadow-xl">
            <p className="mb-5 text-xs font-semibold tracking-[0.18em] text-indigo-200">LESS COORDINATION. MORE FOCUS.</p>
            <div className="space-y-5">
              {[
                ["01", "Find your resource", "Explore spaces, equipment, and resource details."],
                ["02", "Reserve your time", "Choose a time that works for you."],
                ["03", "Stay organized", "View and manage your reservations in one place."],
              ].map(([step, title, description]) => (
                <div key={step} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-300/10 text-xs font-semibold text-indigo-200 ring-1 ring-indigo-300/20">{step}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <p className="mt-1 text-sm leading-5 text-slate-300">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="relative text-xs text-slate-400">A simpler way to manage shared resources.</p>
      </aside>

      <section aria-label="Authentication form" className="flex min-h-dvh min-w-0 flex-col px-5 py-8 sm:px-10 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:px-12">
        <div className="mb-9 shrink-0 lg:hidden"><Brand /><p className="mt-3 text-sm text-slate-500">Your resources. Your time. One place.</p></div>
        <div className="my-auto w-full max-w-md shrink-0 self-center py-4 lg:py-10">{children}</div>
        <p className="mt-8 shrink-0 text-center text-xs leading-5 text-slate-500">ReserveHub · Resource Reservation Management</p>
      </section>
    </main>
  );
}
