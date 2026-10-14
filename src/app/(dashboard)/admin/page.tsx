import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } });
  if (user?.role !== "ADMIN") redirect("/");
  let summary: [number, number, number] | null = null;
  try { summary = await Promise.all([prisma.resource.count(), prisma.resource.count({ where: { isActive: true } }), prisma.resource.count({ where: { isActive: false } })]); }
  catch (error) { console.error("Error loading admin resource summary:", error); }
  return <div className="mx-auto max-w-[1440px] space-y-7 p-5 font-sans text-slate-900 sm:p-7 lg:p-9">
    <header><h1 className="text-3xl font-bold tracking-tight">Admin Panel</h1><p className="mt-2 text-sm leading-6 text-slate-500">Keep your resource catalog organized, accurate, and ready for bookings.</p></header>
    <section className="rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-6 text-white sm:p-8"><p className="text-xs font-semibold tracking-widest text-indigo-300">YOUR RESOURCE OPERATIONS</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">Better resources. Smoother reservations.</h2><p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">Create resources, update their details, and control which resources accept new bookings.</p></section>
    {!summary && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Resource counts are temporarily unavailable. Refresh to try again.</p>}
    <section aria-label="Resource summary" className="grid gap-5 sm:grid-cols-3">{["Total Resources", "Active Resources", "Inactive Resources"].map((label, index) => <div key={label} className="rounded-2xl border border-slate-200/80 bg-white p-4.5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{summary?.[index] ?? "—"}</p></div>)}</section>
    <section aria-label="Resource management actions" className="grid gap-5 lg:grid-cols-3">{[
      { title: "Add New Resource", description: "Add a space or equipment to the catalog.", href: "/admin/resources/new", action: "Create a resource", icon: "plus" },
      { title: "Manage Resources", description: "Edit details and manage resource activation.", href: "/resources", action: "Open resource catalog", icon: "grid" },
      { title: "Manage Reservations", description: "Search all user bookings and review details.", href: "/admin/reservations", action: "View all reservations", icon: "grid" },
    ].map((item) => <Link key={item.href} href={item.href} className="group flex flex-col rounded-2xl border border-indigo-100/80 bg-white p-4.5 shadow-sm motion-safe:transition hover:border-indigo-200 hover:bg-slate-50/50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"><span className="inline-flex w-fit rounded-lg bg-indigo-50 p-2 text-indigo-600"><svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{item.icon === "plus" ? <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 7v10M7 12h10" /></> : <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>}</svg></span><h2 className="mt-3 text-lg font-bold">{item.title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p><span className="mt-auto inline-flex items-center pt-3 text-sm font-semibold text-indigo-600">{item.action}</span></Link>)}</section>
    <p className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-5 text-xs leading-6 text-slate-600">Active means enabled for new bookings, not guaranteed time-slot availability. Deactivation preserves the resource and does not cancel existing reservations.</p>
  </div>;
}
