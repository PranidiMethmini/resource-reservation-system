import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const timeZone = "Asia/Colombo";
const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true });
const dayFormatter = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit" });
const monthFormatter = new Intl.DateTimeFormat("en-GB", { timeZone, month: "short" });
const todayFormatter = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
type IconName = "resources" | "check" | "calendar" | "clock" | "arrow" | "location" | "admin";

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    resources: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 5h3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    admin: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

async function getDashboardData(email: string, now: Date) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, role: true } });
  if (!user) throw new Error("Dashboard user account not found");
  const upcomingWhere = { userId: user.id, status: "CONFIRMED" as const, startTime: { gt: now } };
  const [totalResources, availableResources, myReservations, upcomingCount, upcomingReservations] = await Promise.all([
    prisma.resource.count(),
    prisma.resource.count({ where: { isActive: true } }),
    prisma.reservation.count({ where: { userId: user.id, status: "CONFIRMED" } }),
    prisma.reservation.count({ where: upcomingWhere }),
    prisma.reservation.findMany({
      where: upcomingWhere,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: 5,
      select: { id: true, startTime: true, endTime: true, status: true, resource: { select: { name: true, location: true } } },
    }),
  ]);
  return { user, totalResources, availableResources, myReservations, upcomingCount, upcomingReservations };
}

const focusStyle = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const now = new Date();
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  try {
    data = await getDashboardData(session.user.email, now);
  } catch (error) {
    console.error("Error loading dashboard:", error);
  }
  const name = data?.user.name || session.user.name || session.user.email;
  const stats: { label: string; value: number | string; detail: string; icon: IconName; color: string; featured?: boolean }[] = [
    { label: "Total Resources", value: data?.totalResources ?? "—", detail: "Across your resource library", icon: "resources", color: "bg-blue-50 text-blue-600" },
    { label: "Available Resources", value: data?.availableResources ?? "—", detail: "Active and open for booking", icon: "check", color: "bg-emerald-50 text-emerald-600" },
    { label: "My Confirmed Reservations", value: data?.myReservations ?? "—", detail: "Your confirmed bookings, all time", icon: "calendar", color: "bg-violet-50 text-violet-600" },
    { label: "My Upcoming Reservations", value: data?.upcomingCount ?? "—", detail: "Your confirmed bookings ahead", icon: "clock", color: "bg-white/15 text-indigo-100", featured: true },
  ];
  const actions: { title: string; description: string; href: string; icon: IconName }[] = [
    { title: "Browse Resources", description: "Find a space or equipment", href: "/resources", icon: "resources" },
    { title: "Book a Resource", description: "Choose a resource and time", href: "/book", icon: "calendar" },
    { title: "My Reservations", description: "Review and manage bookings", href: "/reservations", icon: "clock" },
    ...(data?.user.role === "ADMIN" ? [{ title: "Manage Resources", description: "Open your Admin Panel", href: "/admin", icon: "admin" as const }] : []),
  ];

  return (
    <div className="mx-auto max-w-[1440px] space-y-7 p-5 font-sans text-slate-900 sm:p-7 lg:p-9">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-500">Your resources and reservations, in one place.</p>
        </div>
        <p className="flex shrink-0 items-center gap-2 text-xs text-slate-500"><Icon name="calendar" className="h-4 w-4" />{todayFormatter.format(now)}</p>
      </header>

      <section aria-labelledby="welcome-heading" className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-6 text-white shadow-sm sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 -z-10 h-80 w-80 rounded-full border-[40px] border-white/5" />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <p className="mb-3 text-xs font-semibold tracking-widest text-indigo-300">MAKE ROOM FOR WHAT’S NEXT</p>
            <h2 id="welcome-heading" className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back, {name}.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Plan your time and keep your bookings organized.</p>
          </div>
          <Link href="/book" className="inline-flex w-fit shrink-0 items-center justify-center gap-3 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-900 shadow-sm motion-safe:transition hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Book a Resource<Icon name="arrow" className="h-4 w-4" /></Link>
        </div>
      </section>

      {!data && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">We couldn’t load your dashboard data. Refresh the page to try again.</p>}

      <section aria-label="Dashboard statistics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className={`min-w-0 rounded-2xl border p-5 shadow-sm motion-safe:transition-shadow hover:shadow-md ${stat.featured ? "border-indigo-600 bg-gradient-to-br from-indigo-600 to-blue-700 text-white" : "border-indigo-100/80 bg-white"}`}>
            <span className={`mb-5 inline-flex rounded-xl p-3 ${stat.color}`}><Icon name={stat.icon} /></span>
            <p className="text-3xl font-bold tracking-tight tabular-nums">{stat.value}</p>
            <h2 className={`mt-2 text-sm font-semibold ${stat.featured ? "text-white" : "text-slate-700"}`}>{stat.label}</h2>
            <p className={`mt-2 text-xs leading-5 ${stat.featured ? "text-indigo-100" : "text-slate-500"}`}>{stat.detail}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <section aria-labelledby="upcoming-heading" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-6">
            <div>
              <h2 id="upcoming-heading" className="text-lg font-semibold tracking-tight">Upcoming Reservations</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Confirmed bookings · Sri Lanka time (Asia/Colombo)</p>
            </div>
            <Link href="/reservations" className={`inline-flex items-center gap-1 rounded text-xs font-semibold text-indigo-600 hover:text-indigo-800 ${focusStyle}`}>View all<Icon name="arrow" className="h-4 w-4" /></Link>
          </div>
          {!data ? (
            <div className="p-8 text-center text-sm text-slate-500">Upcoming reservations are temporarily unavailable.</div>
          ) : data.upcomingReservations.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="mb-5 rounded-2xl bg-indigo-50 p-5 text-indigo-500"><Icon name="calendar" className="h-8 w-8" /></div>
              <h3 className="text-lg font-semibold">Your next plan starts here</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">No upcoming reservations yet. Find a resource and reserve your time.</p>
              <Link href="/book" className={`mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white motion-safe:transition hover:bg-indigo-700 ${focusStyle}`}>Book a Resource<Icon name="arrow" className="h-4 w-4" /></Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.upcomingReservations.map((reservation) => {
                const startDate = dateFormatter.format(reservation.startTime);
                const endDate = dateFormatter.format(reservation.endTime);
                return (
                  <article key={reservation.id} className="flex items-start gap-4 p-5 motion-safe:transition-colors hover:bg-slate-50 sm:p-6">
                    <div aria-hidden="true" className="flex w-14 shrink-0 flex-col items-center rounded-xl border border-indigo-100 bg-indigo-50 py-3 text-indigo-700"><span className="text-xl font-bold leading-none">{dayFormatter.format(reservation.startTime)}</span><span className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide">{monthFormatter.format(reservation.startTime)}</span></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="break-words text-sm font-semibold text-slate-900">{reservation.resource.name}</h3>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700"><span aria-hidden="true" className="h-1 w-1 rounded-full bg-emerald-500" />Confirmed</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{startDate} · {timeFormatter.format(reservation.startTime)} – {startDate !== endDate && `${endDate} · `}{timeFormatter.format(reservation.endTime)}</p>
                      {reservation.resource.location && <p className="mt-2 flex items-start gap-1.5 break-words text-xs leading-5 text-slate-500"><Icon name="location" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{reservation.resource.location}</p>}
                    </div>
                  </article>
                );
              })}
              {data.upcomingCount > 5 && <p className="px-6 py-4 text-xs text-slate-500">Showing your next 5 of {data.upcomingCount} upcoming reservations. <Link href="/reservations" className={`rounded font-semibold text-indigo-600 ${focusStyle}`}>View all reservations</Link></p>}
            </div>
          )}
        </section>

        <section aria-labelledby="actions-heading" className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-indigo-600">KEEP THINGS MOVING</p>
          <h2 id="actions-heading" className="text-lg font-semibold tracking-tight">Quick Actions</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Your next step, a click away.</p>
          <div className="mt-5 space-y-3">
            {actions.map((action) => (
              <Link key={action.href} href={action.href} className={`group flex items-center gap-3 rounded-xl border border-slate-200 p-4 motion-safe:transition hover:border-indigo-200 hover:bg-indigo-50/50 ${focusStyle}`}>
                <span className="shrink-0 rounded-lg bg-slate-50 p-2.5 text-indigo-600 group-hover:bg-indigo-100"><Icon name={action.icon} className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{action.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{action.description}</span></span>
                <Icon name="arrow" className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-indigo-600" />
              </Link>
            ))}
          </div>
          <div className="mt-6 rounded-xl bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-800"><Icon name="clock" className="h-4 w-4" />Plan with confidence</div>
            <p className="mt-2 text-xs leading-6 text-slate-600">Booking times use Asia/Colombo. Review your resource and time before confirming.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
