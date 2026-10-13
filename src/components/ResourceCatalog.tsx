"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { filterResources, type CatalogResource, type ResourceFilters } from "@/lib/resource-catalog";

type IconName = "resource" | "search" | "location" | "people" | "arrow" | "edit";
function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    resource: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2m3-7a5 5 0 0 1 3 5v2M16 5a3 3 0 0 1 0 6" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    edit: <><path d="m16 3 5 5-12 12-6 1 1-6L16 3Z" /><path d="m13 6 5 5" /></>,
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500";
const control = "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none motion-safe:transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10";

function ResourceCard({ resource, isAdmin }: { resource: CatalogResource; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article aria-labelledby={`resource-${resource.id}`} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-indigo-100/80 bg-white shadow-sm motion-safe:transition hover:border-indigo-200 hover:shadow-md">
      <div aria-hidden="true" className={`h-1 ${resource.isActive ? "bg-gradient-to-r from-blue-500 to-indigo-500" : "bg-slate-300"}`} />
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className={`inline-flex rounded-xl p-2.5 ${resource.isActive ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-500"}`}><Icon name="resource" className="h-5 w-5" /></span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${resource.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${resource.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />{resource.isActive ? "Active" : "Inactive"}</span>
        </div>
        <p className="mb-2 break-words text-xs font-semibold uppercase tracking-wide text-indigo-600">{resource.type}</p>
        <h2 id={`resource-${resource.id}`} className="break-words text-xl font-semibold tracking-tight text-slate-900">{resource.name}</h2>
        {resource.description && (
          <div className="mt-3">
            <p id={`description-${resource.id}`} className={`break-words text-sm leading-6 text-slate-500 ${expanded ? "" : "line-clamp-3"}`}>{resource.description}</p>
            {resource.description.length > 120 && <button type="button" aria-expanded={expanded} aria-controls={`description-${resource.id}`} onClick={() => setExpanded(!expanded)} className={`mt-2 rounded text-xs font-semibold text-indigo-600 hover:text-indigo-800 ${focus}`}>{expanded ? "Show less" : "Read more"}<span className="sr-only"> about {resource.name}</span></button>}
          </div>
        )}
        <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
          <div className="flex items-start gap-2.5"><dt className="shrink-0 text-slate-400"><Icon name="location" className="h-4 w-4" /><span className="sr-only">Location</span></dt><dd className="min-w-0 break-words text-slate-600">{resource.location}</dd></div>
          <div className="flex items-center gap-2.5"><dt className="shrink-0 text-slate-400"><Icon name="people" className="h-4 w-4" /><span className="sr-only">Capacity</span></dt><dd className="text-slate-600">Capacity: <span className="font-semibold text-slate-800">{resource.capacity}</span></dd></div>
        </dl>
        <div className="mt-auto pt-4">
          {resource.isActive ? <Link href={`/book?resourceId=${encodeURIComponent(resource.id)}`} aria-label={`Book Resource: ${resource.name}`} className={`flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white motion-safe:transition hover:bg-indigo-700 ${focus}`}>Book Resource<Icon name="arrow" className="h-4 w-4" /></Link> : <p className="rounded-xl bg-slate-100 px-4 py-2.5 text-center text-sm font-medium text-slate-500">Unavailable for booking</p>}
          {isAdmin && <Link href={`/admin/resources/${encodeURIComponent(resource.id)}/edit`} aria-label={`Edit Resource: ${resource.name}`} className={`mt-2 flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 motion-safe:transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 ${focus}`}><Icon name="edit" className="h-4 w-4" />Edit Resource</Link>}
        </div>
      </div>
    </article>
  );
}

export default function ResourceCatalog({ resources, isAdmin }: { resources: CatalogResource[]; isAdmin: boolean }) {
  const [filters, setFilters] = useState<ResourceFilters>({ search: "", type: "", status: "all" });
  const types = useMemo(() => [...new Set(resources.map((resource) => resource.type))].sort((a, b) => a.localeCompare(b, "en")), [resources]);
  const filtered = useMemo(() => filterResources(resources, filters), [resources, filters]);
  const hasFilters = Boolean(filters.search || filters.type || filters.status !== "all");
  function clearFilters() { setFilters({ search: "", type: "", status: "all" }); }

  return (
    <>
      <section aria-label="Search and filter resources" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor="resource-search" className="mb-2 block text-xs font-semibold text-slate-600">Search resources</label>
            <div className="relative"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400"><Icon name="search" className="h-4 w-4" /></span><input id="resource-search" type="search" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search name, type, or location…" className={`${control} pl-10`} /></div>
          </div>
          <div><label htmlFor="resource-type" className="mb-2 block text-xs font-semibold text-slate-600">Resource type</label><select id="resource-type" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className={control}><option value="">All types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
          <div><label htmlFor="resource-status" className="mb-2 block text-xs font-semibold text-slate-600">Activation status</label><select id="resource-status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as ResourceFilters["status"] })} className={control}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        </div>
        <div className="mt-4 flex min-h-6 flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" aria-atomic="true" className="text-xs text-slate-500"><span className="font-semibold text-slate-800">{filtered.length}</span> matching {filtered.length === 1 ? "resource" : "resources"} of {resources.length}</p>
          <button type="button" onClick={clearFilters} disabled={!hasFilters} className={`rounded text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:cursor-default disabled:text-slate-400 ${focus}`}>Clear Filters</button>
        </div>
      </section>

      {resources.length === 0 || filtered.length === 0 ? (
        <section className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <span className="mb-5 rounded-2xl bg-indigo-50 p-5 text-indigo-500"><Icon name={resources.length === 0 ? "resource" : "search"} className="h-8 w-8" /></span>
          <h2 className="text-lg font-semibold">{resources.length === 0 ? "Your resource catalog starts here" : "No matching resources"}</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{resources.length === 0 ? isAdmin ? "Add your first resource to make it bookable for your users." : "No resources have been added yet. Please check back soon." : "Try a different name or location, or clear your filters to explore the full catalog."}</p>
          {resources.length > 0 ? <button type="button" onClick={clearFilters} className={`mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 ${focus}`}>Clear Filters</button> : isAdmin && <Link href="/admin/resources/new" className={`mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 ${focus}`}>Add New Resource</Link>}
        </section>
      ) : <section aria-label="Resource catalog" className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">{filtered.map((resource) => <ResourceCard key={resource.id} resource={resource} isAdmin={isAdmin} />)}</section>}
    </>
  );
}
