"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CatalogResource } from "@/lib/resource-catalog";
import { colomboDate, parseBookingTime, validateBooking, formatBookingDate, formatBookingTime, formatDuration } from "@/lib/booking";

type Resource = Pick<CatalogResource, "id" | "name" | "type" | "location" | "capacity" | "isActive">;
type Confirmation = { resource: Resource; start: Date; end: Date };
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500";
const input = "mt-2 block w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-50 aria-invalid:border-red-500";

function CalendarIcon({ success = false }: { success?: boolean }) {
  return <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{success ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></> : <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 5h3" /></>}</svg>;
}

export default function BookingForm({ resources, initialResourceId, today }: { resources: Resource[]; initialResourceId: string; today: string }) {
  const router = useRouter();
  const validInitial = resources.some((item) => item.id === initialResourceId && item.isActive);
  const [resourceId, setResourceId] = useState(validInitial ? initialResourceId : "");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [minDate, setMinDate] = useState(today);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pending = useRef(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const resourceRef = useRef<HTMLSelectElement>(null);
  const selected = resources.find((item) => item.id === resourceId && item.isActive);
  const start = parseBookingTime(date, startTime);
  const end = parseBookingTime(date, endTime);
  const duration = start && end && end > start ? (end.getTime() - start.getTime()) / 60000 : null;

  useEffect(() => {
    const timer = setInterval(() => setMinDate(colomboDate(new Date())), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (confirmation) confirmationRef.current?.focus(); }, [confirmation]);

  function clearError() { setMessage(""); setFieldError(""); setLoginRequired(false); }
  function invalid(form: HTMLFormElement, field: string, text: string) {
    setFieldError(field); setMessage(text);
    const target = form.elements.namedItem(field);
    if (target instanceof HTMLElement) target.focus();
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || confirmation) return;
    clearError();
    if (!selected) { invalid(event.currentTarget, "resource", "Choose an active resource to continue."); return; }
    const validation = validateBooking(date, startTime, endTime);
    if (!validation.ok) { invalid(event.currentTarget, validation.field, validation.message); return; }
    pending.current = true; setSubmitting(true);
    let completed = false;
    try {
      const response = await fetch("/api/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: selected.id, startTime: validation.start.toISOString(), endTime: validation.end.toISOString() }),
      });
      if (!response.ok) {
        if (response.status === 409) setMessage("This time overlaps an existing reservation for this resource. Choose another time and try again.");
        else if (response.status === 401) { setLoginRequired(true); setMessage("Your session has expired. Sign in again to make your reservation."); }
        else if (response.status === 404) { setMessage("This resource is no longer bookable. Choose another resource."); router.refresh(); }
        else if (response.status === 400) setMessage("The reservation details are no longer valid. Check the date and time, then try again.");
        else setMessage("We couldn’t confirm your reservation. Check My Reservations before retrying.");
        return;
      }
      const result = await response.json();
      const bookedStart = new Date(result.startTime);
      const bookedEnd = new Date(result.endTime);
      if (!result.id || result.resourceId !== selected.id || result.status !== "CONFIRMED" || Number.isNaN(bookedStart.getTime()) || Number.isNaN(bookedEnd.getTime())) throw new Error("Unexpected reservation response");
      completed = true;
      setConfirmation({ resource: selected, start: bookedStart, end: bookedEnd });
      router.refresh();
    } catch {
      setMessage("We couldn’t confirm the result. Check your connection and My Reservations before retrying; your booking may have been saved.");
    } finally {
      if (!completed) pending.current = false;
      setSubmitting(false);
    }
  }

  if (confirmation) return (
    <div ref={confirmationRef} tabIndex={-1} className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm outline-none sm:p-10">
      <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CalendarIcon success /></span>
      <p role="status" className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Reservation confirmed</p>
      <h2 className="mt-3 text-2xl font-bold tracking-tight">You’re all booked!</h2>
      <p className="mt-2 text-sm text-slate-500">Your reservation is saved and ready to view.</p>
      <div className="my-7 rounded-xl border border-indigo-100 bg-indigo-50/50 p-5 text-left">
        <h3 className="break-words text-lg font-semibold">{confirmation.resource.name}</h3>
        <p className="mt-1 text-sm text-slate-500">{confirmation.resource.type} · {confirmation.resource.location}</p>
        <p className="mt-4 text-sm font-medium">{formatBookingDate(confirmation.start)}</p>
        <p className="mt-1 text-sm text-indigo-700">{formatBookingTime(confirmation.start)} – {formatBookingTime(confirmation.end)} · {formatDuration((confirmation.end.getTime() - confirmation.start.getTime()) / 60000)}</p>
        <p className="mt-3 text-xs text-slate-500">Sri Lanka time (Asia/Colombo)</p>
      </div>
      <div className="flex flex-col justify-center gap-3 sm:flex-row">
        <Link href="/reservations" className={`rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 ${focus}`}>View My Reservations</Link>
        <button type="button" onClick={() => { pending.current = false; setConfirmation(null); setResourceId(""); setDate(""); setStartTime(""); setEndTime(""); clearError(); setTimeout(() => resourceRef.current?.focus(), 0); }} className={`rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${focus}`}>Book another resource</button>
      </div>
    </div>
  );

  if (resources.length === 0) return <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><h2 className="text-xl font-semibold">No active resources to book</h2><p className="mt-3 text-sm text-slate-500">Resources may be inactive right now. Check the catalog again later.</p><Link href="/resources" className={`mt-6 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white ${focus}`}>Browse Resources</Link></section>;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
      <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3"><span className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><CalendarIcon /></span><div><h2 className="text-lg font-semibold">Plan your reservation</h2><p className="mt-1 text-xs text-slate-500">Choose a resource and the time you need.</p></div></div>
        {initialResourceId && !validInitial && <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">The linked resource is missing or inactive. Please choose an active resource below.</p>}
        <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
          <fieldset disabled={submitting || loginRequired} className="min-w-0 space-y-6">
            <legend className="sr-only">Reservation details</legend>
            <div><label htmlFor="resource" className="text-sm font-semibold text-slate-700">Resource</label><select ref={resourceRef} id="resource" name="resource" required value={selected ? resourceId : ""} onChange={(event) => { setResourceId(event.target.value); clearError(); }} aria-invalid={fieldError === "resource"} aria-describedby={fieldError === "resource" ? "booking-error" : undefined} className={input}><option value="">Choose an active resource</option>{resources.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name} — {item.type}</option>)}</select></div>
            {selected && <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4"><p className="text-sm font-semibold text-indigo-900">{selected.type}</p><p className="mt-1 break-words text-sm text-slate-600">{selected.location} · Capacity: {selected.capacity}</p><p className="mt-2 text-xs text-slate-500">Active resource · Time-slot availability checked on submission</p></div>}
            <div><label htmlFor="date" className="text-sm font-semibold text-slate-700">Reservation date</label><input id="date" name="date" type="date" required min={minDate} value={date} onChange={(event) => { setDate(event.target.value); clearError(); }} aria-invalid={fieldError === "date"} aria-describedby={fieldError === "date" ? "booking-error" : "timezone-note"} className={input} /></div>
            <div className="grid gap-4 sm:grid-cols-2">{[{ id: "startTime", label: "Start time", value: startTime, setter: setStartTime }, { id: "endTime", label: "End time", value: endTime, setter: setEndTime }].map((field) => <div key={field.id}><label htmlFor={field.id} className="text-sm font-semibold text-slate-700">{field.label}</label><input id={field.id} name={field.id} type="time" step={60} required value={field.value} onChange={(event) => { field.setter(event.target.value); clearError(); }} aria-invalid={fieldError === field.id} aria-describedby={fieldError === field.id ? "booking-error" : "timezone-note"} className={input} /></div>)}</div>
          </fieldset>
          <p id="timezone-note" className="mt-4 text-xs leading-6 text-slate-500">All dates and times use Sri Lanka time (Asia/Colombo, UTC+05:30). Start and end times must be on the same date.</p>
          {message && <div id="booking-error" role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700"><p>{message}</p><Link href={loginRequired ? "/login" : "/reservations"} className={`mt-2 inline-block rounded font-semibold underline ${focus}`}>{loginRequired ? "Sign In" : "View My Reservations"}</Link></div>}
          <button type="submit" disabled={submitting || loginRequired} className={`mt-6 w-full rounded-xl bg-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-sm motion-safe:transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 ${focus}`}>{submitting ? "Confirming your reservation…" : "Check & Reserve"}</button>
          <p className="mt-3 text-center text-xs leading-5 text-slate-500">Your booking is confirmed only after it is saved successfully.</p>
        </form>
      </section>

      <aside aria-label="Live booking summary" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-6 text-white"><p className="text-xs font-semibold tracking-widest text-indigo-300">YOUR NEXT PLAN</p><h2 className="mt-2 text-xl font-semibold">Booking summary</h2><p className="mt-2 text-xs leading-5 text-slate-300">Review your details before reserving.</p></div>
        <div className="p-6">{selected && <><h3 className="break-words text-lg font-semibold text-slate-900">{selected.name}</h3><p className="mt-1 text-sm text-slate-500">{selected.type}</p></>}
          <dl className="mt-6 space-y-4 text-sm">{[
            ["Date", start ? formatBookingDate(start) : parseBookingTime(date, "12:00") ? formatBookingDate(parseBookingTime(date, "12:00")!) : null],
            ["Start", start ? formatBookingTime(start) : null],
            ["End", end ? formatBookingTime(end) : null],
            ["Duration", duration ? formatDuration(duration) : null],
            ["Location", selected?.location || null],
            ["Capacity", selected ? String(selected.capacity) : null],
          ].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4"><dt className="shrink-0 text-slate-500">{label}</dt><dd className="min-w-0 break-words text-right font-medium text-slate-800">{value ?? ""}</dd></div>)}</dl>
          <Link href="/resources" className={`mt-4 inline-block rounded text-sm font-semibold text-indigo-600 hover:text-indigo-800 ${focus}`}>Explore other resources →</Link>
        </div>
      </aside>
    </div>
  );
}
