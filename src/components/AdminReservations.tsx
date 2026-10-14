"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { filterAdminReservations, type AdminReservation, type AdminSort } from "@/lib/admin-reservations";
import { reservationState, type ReservationFilter } from "@/lib/reservations";
import { formatBookingDate, formatBookingTime, formatDuration } from "@/lib/booking";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500";
const control = "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10";
const dateTime = (value: string) => `${formatBookingDate(new Date(value))} · ${formatBookingTime(new Date(value))}`;

export default function AdminReservations() {
  const [records, setRecords] = useState<AdminReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState<401 | 403 | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReservationFilter>("all");
  const [resource, setResource] = useState("");
  const [sort, setSort] = useState<AdminSort>("upcoming");
  const [now, setNow] = useState(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/admin/reservations", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { setDenied(response.status); setRecords([]); return; }
      if (!response.ok) throw new Error("Unable to load");
      const data: AdminReservation[] = await response.json();
      if (!controller.signal.aborted) { setRecords(data); setNow(Date.now()); setError(""); setDenied(null); }
    } catch { if (!controller.signal.aborted) { setRecords([]); setError("We couldn’t load reservations. Please try again."); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => { clearTimeout(initial); clearInterval(timer); request.current?.abort(); };
  }, [load]);
  function reload() { setLoading(true); setError(""); void load(); }
  const visible = filterAdminReservations(records, filter, search, resource, sort, now);
  const resources = [...new Map(records.map((item) => [item.resourceId, item.resource.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], "en"));
  const summary = [records.length, records.filter((item) => item.status === "CONFIRMED").length, records.filter((item) => item.status === "CANCELLED").length, records.filter((item) => reservationState(item, now) === "Upcoming").length];
  return <div className="mx-auto max-w-[1440px] space-y-6 p-5 font-sans text-slate-900 sm:p-7 lg:p-9">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight">Manage Reservations</h1><p className="mt-2 text-sm text-slate-500">Read-only reservation overview across all users.</p></div></header>
    {loading ? <p role="status" className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500">Loading reservations…</p> : denied ? <section className="rounded-2xl bg-white p-8 text-center"><h2 className="text-lg font-semibold">{denied === 401 ? "Sign in required" : "Admin access required"}</h2><Link href={denied === 401 ? "/login" : "/"} className={`mt-5 inline-block rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white ${focus}`}>{denied === 401 ? "Sign In" : "Dashboard"}</Link></section> : error ? <section role="alert" className="rounded-2xl border border-red-200 bg-white p-8 text-center"><p className="text-sm text-red-700">{error}</p><button onClick={reload} className={`mt-5 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white ${focus}`}>Retry</button></section> : <>
      <section aria-label="Reservation summary" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{["Total Reservations", "Confirmed", "Cancelled", "Upcoming Confirmed"].map((label, index) => <div key={label} className="rounded-2xl border border-indigo-200 bg-white p-4.5 shadow-sm ring-1 ring-indigo-100/40 motion-safe:transition-shadow hover:shadow-md"><h2 className="text-sm font-medium text-slate-500">{label}</h2><p className="mt-3 text-3xl font-extrabold tabular-nums text-indigo-900">{summary[index]}</p></div>)}</section>
      <section aria-label="Filter reservations" className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"><div><label htmlFor="admin-search" className="mb-2 block text-xs font-medium text-slate-600">Search resource or user</label><input id="admin-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Resource, name, or email" className={control} /></div><div><label htmlFor="admin-resource" className="mb-2 block text-xs font-medium text-slate-600">Resource</label><select id="admin-resource" value={resource} onChange={(event) => setResource(event.target.value)} className={control}><option value="">All resources</option>{resources.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div><label htmlFor="admin-sort" className="mb-2 block text-xs font-medium text-slate-600">Sort</label><select id="admin-sort" value={sort} onChange={(event) => setSort(event.target.value as AdminSort)} className={control}><option value="upcoming">Upcoming first</option><option value="newest">Newest created first</option><option value="oldest">Oldest created first</option></select></div></div>
        <div role="group" aria-label="Reservation status filter" className="mt-4 flex flex-wrap gap-2">{(["all", "upcoming", "past", "cancelled"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-lg px-3 py-2 text-sm font-medium capitalize ${filter === value ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-600 hover:bg-indigo-50"} ${focus}`}>{value}</button>)}</div>
        <div className="mt-4 flex flex-wrap justify-between gap-2"><p aria-live="polite" className="text-xs text-slate-500">{visible.length} matching reservations of {records.length} · Asia/Colombo</p><button onClick={() => { setSearch(""); setFilter("all"); setResource(""); setSort("upcoming"); }} className={`rounded text-xs font-semibold text-indigo-600 ${focus}`}>Clear filters</button></div>
      </section>
      {visible.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><h2 className="text-lg font-semibold">{records.length === 0 ? "No reservations yet" : "No matching reservations"}</h2><p className="mt-3 text-sm text-slate-500">{records.length === 0 ? "Reservations will appear here when users make bookings." : "Try another search or clear your filters."}</p></section> : <section aria-label="All user reservations" className="grid gap-5 xl:grid-cols-2">{visible.map((item) => {
        const start = new Date(item.startTime), end = new Date(item.endTime);
        const startDate = formatBookingDate(start), endDate = formatBookingDate(end);
        return <article key={item.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4.5 shadow-sm"><div className="flex flex-wrap justify-between gap-2"><h2 className="break-words text-lg font-semibold">{item.resource.name}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{item.status === "CONFIRMED" ? "Confirmed" : "Cancelled"}</span></div><p className="mt-2 break-words text-xs text-slate-500">{item.resource.type} · {item.resource.location}</p><p className="mt-4 break-words text-sm text-slate-700">Reserved by <span className="font-semibold">{item.user.name}</span></p><p className="mt-1 break-all text-xs text-slate-500">{item.user.email}</p><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><p>{startDate}</p><p className="mt-1 text-indigo-800">{formatBookingTime(start)} – {startDate !== endDate && `${endDate} · `}{formatBookingTime(end)}</p><p className="mt-2 text-xs text-slate-500">{formatDuration((end.getTime() - start.getTime()) / 60000)} · {reservationState(item, now)}</p></div><details className="mt-4 border-t border-slate-100 pt-3"><summary className={`w-fit cursor-pointer rounded text-xs font-semibold text-indigo-600 ${focus}`}>View Details</summary><dl className="mt-3 space-y-2 text-xs leading-5 text-slate-600">{[["Reservation ID", item.id], ["Resource ID", item.resourceId], ["Reserved by", `${item.user.name} (${item.user.email})`], ["Resource", `${item.resource.name} · ${item.resource.type} · ${item.resource.location}`], ["Start", dateTime(item.startTime)], ["End", dateTime(item.endTime)], ["Status", item.status], ["Created", dateTime(item.createdAt)]].map(([label, value]) => <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 sm:grid-cols-[7rem_minmax(0,1fr)]"><dt className="font-medium text-slate-500">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl></details></article>;
      })}</section>}
    </>}
  </div>;
}
