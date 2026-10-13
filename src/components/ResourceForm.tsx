"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CatalogResource } from "@/lib/resource-catalog";
import { validateResource, resourcePayload, type ResourceValues, type ResourceField } from "@/lib/resource-form";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500";
const input = "mt-2 block w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-50 aria-invalid:border-red-500";
const blank: ResourceValues = { name: "", type: "", location: "", capacity: "", description: "", isActive: true };
export default function ResourceForm({ initial }: { initial?: CatalogResource }) {
  const router = useRouter();
  const editing = Boolean(initial);
  const [values, setValues] = useState<ResourceValues>(initial ? { ...initial, capacity: String(initial.capacity), description: initial.description || "" } : blank);
  const [saved, setSaved] = useState<CatalogResource | null>(initial || null);
  const [errors, setErrors] = useState<Partial<Record<ResourceField, string>>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<"save" | "deactivate" | null>(null);
  const [authError, setAuthError] = useState<401 | 403 | null>(null);
  const [confirmation, setConfirmation] = useState<"save" | "deactivate" | null>(null);
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const finishedCreate = !editing && Boolean(saved);

  useEffect(() => {
    if (!confirmation) return;
    const element = dialog.current;
    element?.showModal(); keep.current?.focus();
    return () => { if (element?.open) element.close(); };
  }, [confirmation]);
  useEffect(() => { if (error || success) notice.current?.focus(); }, [error, success]);

  function update(field: keyof ResourceValues, value: string | boolean) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setError(""); setSuccess("");
  }
  async function perform(action: "save" | "deactivate") {
    if (pending.current || authError || finishedCreate) return;
    if (action === "save") {
      const validation = validateResource(values);
      if (Object.keys(validation).length) { setErrors(validation); setConfirmation(null); return; }
    }
    pending.current = true; setBusy(action); setError(""); setSuccess("");
    try {
      const endpoint = editing ? `/api/resources/${encodeURIComponent(initial!.id)}` : "/api/resources";
      const payload = resourcePayload(values);
      const response = await fetch(endpoint, {
        method: action === "deactivate" ? "DELETE" : editing ? "PATCH" : "POST",
        ...(action === "save" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? payload : { name: payload.name, type: payload.type, location: payload.location, capacity: payload.capacity, description: payload.description }) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setAuthError(response.status); setError(response.status === 401 ? "Your session has expired. Sign in again to continue." : "Admin permission is required to manage resources."); }
        else if (response.status === 404) setError("This resource could not be found. Return to the catalog to check its current state.");
        else if (response.status === 400) setError(action === "deactivate" ? "This resource may already be inactive. Refresh the page to check its status." : "Please check the resource details and try again.");
        else setError("We couldn’t confirm the change. Check the catalog before retrying.");
        return;
      }
      const result = await response.json();
      const resource: CatalogResource = action === "deactivate" ? result.resource : result;
      if (!resource?.id || (editing && resource.id !== initial!.id) || typeof resource.isActive !== "boolean") throw new Error("Unexpected response");
      setSaved(resource);
      setValues({ ...resource, capacity: String(resource.capacity), description: resource.description || "" });
      setSuccess(action === "deactivate" ? "Resource deactivated. New bookings are prevented; existing reservations remain unchanged." : editing ? "Resource changes saved successfully." : "Resource created successfully. It is now active for new bookings.");
      router.refresh();
    } catch { setError("We couldn’t confirm the result. Check your connection and the resource catalog before retrying; your changes may have been saved."); }
    finally { pending.current = false; setBusy(null); setConfirmation(null); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || finishedCreate) return;
    const validation = validateResource(values);
    setErrors(validation); setError(""); setSuccess("");
    const first = Object.keys(validation)[0];
    if (first) { const element = event.currentTarget.elements.namedItem(first); if (element instanceof HTMLElement) element.focus(); return; }
    if (editing && saved?.isActive && !values.isActive) setConfirmation("save");
    else void perform("save");
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
      <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Resource details</h2><p className="mt-2 text-xs leading-6 text-slate-500">Required fields are marked with an asterisk. These details appear in the resource catalog.</p>
        <form onSubmit={submit} noValidate aria-busy={Boolean(busy)} className="mt-6">
          <fieldset disabled={Boolean(busy) || Boolean(authError) || finishedCreate} className="min-w-0 space-y-5"><legend className="sr-only">Resource details</legend>
            <div className="grid gap-5 sm:grid-cols-2">{[
              { name: "name", label: "Resource name", placeholder: "e.g. Meeting Room A" },
              { name: "type", label: "Resource type", placeholder: "e.g. Meeting Room" },
              { name: "location", label: "Location", placeholder: "e.g. Floor 2, North Wing" },
              { name: "capacity", label: "Capacity", placeholder: "e.g. 12" },
            ].map((field) => { const name = field.name as ResourceField; return <div key={name}><label htmlFor={name} className="text-sm font-semibold text-slate-700">{field.label} <span aria-hidden="true" className="text-indigo-500">*</span></label><input id={name} name={name} type={name === "capacity" ? "number" : "text"} min={name === "capacity" ? 1 : undefined} max={name === "capacity" ? 2147483647 : undefined} step={name === "capacity" ? 1 : undefined} required value={values[name]} onChange={(event) => update(name, event.target.value)} placeholder={field.placeholder} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${name}-error` : undefined} className={input} />{errors[name] && <p id={`${name}-error`} className="mt-2 text-xs text-red-700">{errors[name]}</p>}</div>; })}</div>
            <div><label htmlFor="description" className="text-sm font-semibold text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></label><textarea id="description" name="description" rows={4} value={values.description} onChange={(event) => update("description", event.target.value)} placeholder="Describe the space, equipment, or any useful details…" className={`${input} resize-y`} /></div>
            {editing && <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4"><label htmlFor="isActive" className="flex items-center gap-3 text-sm font-semibold text-slate-800"><input id="isActive" type="checkbox" checked={values.isActive} onChange={(event) => update("isActive", event.target.checked)} className="h-4 w-4 accent-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500" />Active for new bookings</label><p className="mt-2 text-xs leading-6 text-slate-500">Inactive resources remain in the catalog. Changing this setting does not cancel existing reservations.</p></div>}
          </fieldset>
          {Object.keys(errors).length > 0 && Object.values(errors).some(Boolean) && <p role="alert" className="mt-4 text-sm text-red-700">Please check the highlighted fields.</p>}
          {(error || success) && <div ref={notice} tabIndex={-1} role={error ? "alert" : "status"} className={`mt-5 rounded-xl border p-4 text-sm leading-6 outline-none ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || success}{authError && <Link href={authError === 401 ? "/login" : "/"} className={`mt-2 block w-fit rounded font-semibold underline ${focus}`}>{authError === 401 ? "Sign In" : "Return to Dashboard"}</Link>}{success && <Link href="/resources" className={`mt-2 block w-fit rounded font-semibold underline ${focus}`}>View resource catalog</Link>}</div>}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {finishedCreate ? <button type="button" onClick={() => { setSaved(null); setValues(blank); setSuccess(""); setErrors({}); }} className={`rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white ${focus}`}>Add another resource</button> : <button type="submit" disabled={Boolean(busy) || Boolean(authError)} className={`rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 ${focus}`}>{busy === "save" ? "Saving resource…" : editing ? "Save Changes" : "Create Resource"}</button>}
            {busy ? <button type="button" disabled className="rounded-xl border border-slate-200 px-5 py-3 text-sm text-slate-400">Cancel</button> : <Link href="/resources" className={`rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 ${focus}`}>{success ? "Back to Resources" : "Cancel"}</Link>}
          </div>
        </form>
      </section>
      <aside className="min-w-0 space-y-5">
        <div className="rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-6 text-white"><p className="text-xs font-semibold tracking-widest text-indigo-300">MANAGE WITH CONFIDENCE</p><h2 className="mt-3 text-xl font-semibold">Clear details. Better bookings.</h2><p className="mt-3 text-sm leading-7 text-slate-300">Use a recognizable name and location so users can find the right resource. Capacity must be a positive whole number.</p><p className="mt-5 border-t border-white/15 pt-4 text-xs leading-6 text-indigo-200">{editing ? `Saved status: ${saved?.isActive ? "Active" : "Inactive"}` : "New resources are active by default."}</p></div>
        {editing && <section className="rounded-2xl border border-red-100 bg-white p-6"><h2 className="font-semibold text-slate-900">Resource activation</h2><p className="mt-3 text-sm leading-6 text-slate-500">Deactivation prevents new bookings. It keeps the resource and all existing reservations intact.</p><button type="button" disabled={Boolean(busy) || Boolean(authError) || !saved?.isActive} onClick={() => setConfirmation("deactivate")} className={`mt-5 w-full rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`}>{busy === "deactivate" ? "Deactivating…" : saved?.isActive ? "Deactivate Resource" : "Resource is inactive"}</button>{!saved?.isActive && <p className="mt-3 text-xs leading-6 text-slate-500">To reactivate, enable Active for new bookings and save your changes.</p>}</section>}
      </aside>
      {confirmation && <dialog ref={dialog} aria-labelledby="deactivate-title" aria-describedby="deactivate-description" onCancel={(event) => { if (pending.current) event.preventDefault(); else setConfirmation(null); }} onClick={(event) => { if (event.target === event.currentTarget && !pending.current) setConfirmation(null); }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border-0 bg-white p-7 text-slate-900 shadow-2xl backdrop:bg-slate-950/50"><h2 id="deactivate-title" className="text-xl font-semibold">Deactivate this resource?</h2><p className="mt-3 break-words text-sm font-semibold">{saved?.name}</p><p id="deactivate-description" className="mt-3 text-sm leading-6 text-slate-500">This prevents new bookings. Existing reservations will remain confirmed and will not be automatically cancelled. The resource will not be deleted.</p><div className="mt-6 flex flex-col gap-3 sm:flex-row"><button ref={keep} type="button" disabled={Boolean(busy)} onClick={() => setConfirmation(null)} className={`flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-60 ${focus}`}>Keep resource</button><button type="button" disabled={Boolean(busy)} onClick={() => void perform(confirmation)} className={`flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 ${focus}`}>{busy ? "Saving…" : confirmation === "save" ? "Save & deactivate" : "Deactivate"}</button></div></dialog>}
    </div>
  );
}
