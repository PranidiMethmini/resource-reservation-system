import ResourceForm from "@/components/ResourceForm";

export default function AddResourcePage() {
  return <div className="mx-auto max-w-[1440px] space-y-7 p-5 font-sans text-slate-900 sm:p-7 lg:p-9"><header><p className="mb-2 text-xs font-semibold tracking-[0.18em] text-indigo-600">RESOURCE MANAGEMENT</p><h1 className="text-3xl font-bold tracking-tight">Add New Resource</h1><p className="mt-2 text-sm leading-6 text-slate-500">Add a space or piece of equipment to your ReserveHub catalog.</p></header><ResourceForm /></div>;
}
