"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { canCancelReservation, organizeReservations, reservationState, type Reservation, type ReservationFilter } from "@/lib/reservations";
import { formatBookingDate, formatBookingTime, formatDuration } from "@/lib/booking";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500";
const filters: { value: ReservationFilter; label: string }[] = [{ value: "all", label: "All" }, { value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }, { value: "cancelled", label: "Cancelled" }];
function CalendarIcon() { return <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 5h3" /></svg>; }

export default function MyReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [filter, setFilter] = useState<ReservationFilter>("all");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(0);
  const [target, setTarget] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);

  const loadReservations = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/reservations", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (controller.signal.aborted) return;
      setLoadError("");
      if (response.status === 401) { setLoginRequired(true); setReservations([]); return; }
      if (!response.ok) throw new Error("Failed to load reservations");
      const data: Reservation[] = await response.json();
      if (!controller.signal.aborted) { setReservations(data); setLoginRequired(false); setNow(Date.now()); }
    } catch {
      if (!controller.signal.aborted) setLoadError("We couldn’t load your reservations. Check your connection and try again.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  function reloadReservations() {
    setLoading(true); setLoadError("");
    void loadReservations();
  }

  useEffect(() => {
    const initialLoad = setTimeout(() => void loadReservations(), 0);
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => { clearTimeout(initialLoad); request.current?.abort(); clearInterval(timer); };
  }, [loadReservations]);
  useEffect(() => {
    if (!target) return;
    const element = dialog.current;
    element?.showModal(); keepButton.current?.focus();
    return () => { if (element?.open) element.close(); };
  }, [target]);
  useEffect(() => { if (error || message) notice.current?.focus(); }, [error, message]);

  async function confirmCancel() {
    if (!target || pending.current) return;
    if (!canCancelReservation(target, Date.now())) { setTarget(null); setError("This reservation has already started and can no longer be cancelled."); setNow(Date.now()); return; }
    pending.current = true; setCancelling(true); setError(""); setMessage("");
    const reservation = target;
    try {
      const response = await fetch(`/api/reservations/${encodeURIComponent(reservation.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }), signal: AbortSignal.timeout(20000),
      });
      if (response.status === 401) { setLoginRequired(true); setReservations([]); setError("Your session has expired. Sign in again to manage your reservations."); return; }
      if (!response.ok) {
        setError(response.status === 400 ? "This booking can no longer be cancelled. Refresh the list to see its current status." : response.status === 404 ? "This reservation could not be found. Refresh your list before trying again." : "We couldn’t confirm the cancellation. Refresh your reservations before retrying.");
        return;
      }
      const result = await response.json();
      if (result.id !== reservation.id || result.status !== "CANCELLED") throw new Error("Unexpected cancellation response");
      setReservations((previous) => previous.map((item) => item.id === reservation.id ? { ...item, status: "CANCELLED" } : item));
      setMessage(`Your reservation for ${reservation.resource.name} was cancelled. The reserved time slot has been released.`);
      router.refresh();
    } catch { setError("We couldn’t confirm the result. Check your connection and refresh the list before retrying; the cancellation may have succeeded."); }
    finally { pending.current = false; setCancelling(false); setTarget(null); setNow(Date.now()); }
  }

  const visible = organizeReservations(reservations, filter, search, now);
  const statusColor = { Upcoming: "bg-indigo-50 text-indigo-700", Ongoing: "bg-emerald-50 text-emerald-700", Completed: "bg-slate-100 text-slate-600", Cancelled: "bg-red-50 text-red-700" };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-5 font-sans text-slate-900 sm:p-7 lg:p-9">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-3xl font-bold tracking-tight">My Reservations</h1><p className="mt-2 text-sm leading-6 text-slate-500">Stay on top of your bookings, from your next plan to your past reservations.</p></div><Link href="/book" className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 ${focus}`}><span aria-hidden="true">+</span>Book Resource</Link></header>
      {(error || message) && <div ref={notice} tabIndex={-1} role={error ? "alert" : "status"} className={`rounded-xl border p-4 text-sm leading-6 outline-none ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || message}{error && !loginRequired && <button type="button" disabled={cancelling || loading} onClick={() => { setError(""); reloadReservations(); }} className={`ml-2 rounded font-semibold underline ${focus}`}>Refresh reservations</button>}</div>}

      {loading ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading your reservations…</div> : loginRequired ? <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><h2 className="text-xl font-semibold">Sign In Required</h2><p className="mt-3 text-sm text-slate-500">Sign in to view and manage your own reservations.</p><Link href="/login" className={`mt-6 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white ${focus}`}>Sign In</Link></section> : loadError ? <section role="alert" className="rounded-2xl border border-red-200 bg-white p-10 text-center"><h2 className="text-xl font-semibold">Let’s try that again</h2><p className="mt-3 text-sm text-slate-500">{loadError}</p><button type="button" onClick={reloadReservations} className={`mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white ${focus}`}>Retry loading</button></section> : (
        <>
          <section aria-label="Organize reservations" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
              <div role="group" aria-label="Filter reservations" className="flex flex-wrap gap-2">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${focus} ${filter === item.value ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-600 hover:bg-indigo-50"}`}>{item.label}</button>)}</div>
              <div className="w-full xl:max-w-xs"><label htmlFor="reservation-search" className="sr-only">Search resource name or location</label><input id="reservation-search" type="search" placeholder="Search resource or location…" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" /></div>
            </div>
            <div className="mt-4 flex flex-wrap justify-between gap-2"><p aria-live="polite" aria-atomic="true" className="text-xs text-slate-500">{visible.length} matching {visible.length === 1 ? "reservation" : "reservations"} of {reservations.length}</p>{(search || filter !== "all") && <button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className={`rounded text-xs font-semibold text-indigo-600 ${focus}`}>Clear filters</button>}</div>
          </section>
          {visible.length === 0 ? <section className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><span className="mb-5 rounded-2xl bg-indigo-50 p-5 text-indigo-500"><CalendarIcon /></span><h2 className="text-xl font-semibold">{reservations.length === 0 ? "Your next plan starts here" : !search && filter === "upcoming" ? "No upcoming reservations" : "No matching reservations"}</h2><p className="mt-3 max-w-md text-sm leading-6 text-slate-500">{reservations.length === 0 ? "You haven’t made a reservation yet. Find a resource and reserve a time that works for you." : !search && filter === "upcoming" ? "You have no confirmed reservations ahead. Ready to plan something new?" : "Try another resource name or location, or clear your filters."}</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link href="/book" className={`rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white ${focus}`}>Book Resource</Link>{reservations.length > 0 && <button type="button" onClick={() => { setFilter("all"); setSearch(""); }} className={`rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 ${focus}`}>View all reservations</button>}</div></section> : <section aria-label="Your reservations" className="grid gap-4 xl:grid-cols-2">{visible.map((reservation) => {
            const state = reservationState(reservation, now);
            const start = new Date(reservation.startTime), end = new Date(reservation.endTime);
            const date = formatBookingDate(start), endDate = formatBookingDate(end);
            return <article key={reservation.id} className="min-w-0 rounded-2xl border border-indigo-100/80 bg-white p-5 shadow-sm motion-safe:transition-shadow hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="mb-2 break-words text-xs font-semibold uppercase tracking-wide text-indigo-600">{reservation.resource.type}</p><h2 className="break-words text-xl font-semibold tracking-tight">{reservation.resource.name}</h2></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusColor[state]}`}>{state}</span></div>
              <p className="mt-2 break-words text-sm text-slate-500">{reservation.resource.location}</p>
              <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Date</dt><dd className="mt-1 font-medium">{date}</dd></div><div><dt className="text-xs text-slate-500">Duration</dt><dd className="mt-1 font-medium">{formatDuration((end.getTime() - start.getTime()) / 60000)}</dd></div><div><dt className="text-xs text-slate-500">Start time</dt><dd className="mt-1 font-medium">{formatBookingTime(start)}</dd></div><div><dt className="text-xs text-slate-500">End time</dt><dd className="mt-1 font-medium">{date !== endDate && `${endDate} · `}{formatBookingTime(end)}</dd></div></dl>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">{reservation.status === "CONFIRMED" ? "Confirmed reservation" : "Cancelled reservation"}</span>{canCancelReservation(reservation, now) ? <button type="button" disabled={cancelling} onClick={() => setTarget(reservation)} aria-label={`Cancel reservation for ${reservation.resource.name}`} className={`rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 ${focus}`}>Cancel Reservation</button> : <p className="text-xs text-slate-400">{state === "Cancelled" ? "Time slot released" : "Cancellation unavailable"}</p>}</div>
            </article>;
          })}</section>}
        </>
      )}
      {target && <dialog ref={dialog} aria-labelledby="cancel-title" aria-describedby="cancel-description" onCancel={(event) => { if (pending.current) event.preventDefault(); else setTarget(null); }} onClick={(event) => { if (event.target === event.currentTarget && !pending.current) setTarget(null); }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-indigo-200/80 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/50 sm:p-6"><span className="mb-3 inline-flex rounded-xl bg-red-50 p-2.5 text-red-600"><CalendarIcon /></span><h2 id="cancel-title" className="text-xl font-semibold">Cancel this reservation?</h2><p id="cancel-description" className="mt-2 text-sm leading-6 text-slate-500">Cancelling releases the reserved time slot for others to book. Your reservation will remain in your Cancelled history.</p><div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="break-words text-sm font-semibold">{target.resource.name}</p><p className="mt-2 text-xs leading-6 text-slate-500">{formatBookingDate(new Date(target.startTime))} · {formatBookingTime(new Date(target.startTime))} – {formatBookingTime(new Date(target.endTime))}<br />Asia/Colombo</p></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><button ref={keepButton} type="button" disabled={cancelling} onClick={() => setTarget(null)} className={`flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50 ${focus}`}>Keep reservation</button><button type="button" disabled={cancelling} onClick={confirmCancel} aria-busy={cancelling} className={`flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 ${focus}`}>{cancelling ? "Cancelling…" : "Yes, cancel"}</button></div></dialog>}
    </div>
  );
}

