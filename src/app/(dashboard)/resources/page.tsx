import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import ResourceCatalog from "@/components/ResourceCatalog";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function loadCatalog(email: string) {
  const [user, resources] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { role: true } }),
    prisma.resource.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, type: true, location: true, capacity: true, description: true, isActive: true },
    }),
  ]);
  return { resources, isAdmin: user?.role === "ADMIN" };
}

export default async function ResourcesPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  let data: Awaited<ReturnType<typeof loadCatalog>> | null = null;
  try { data = await loadCatalog(session.user.email); }
  catch (error) { console.error("Error loading resource catalog:", error); }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-5 font-sans text-slate-900 sm:p-7 lg:p-9">
      <header className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resources</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Find the right space or equipment for your next plan.</p>
        </div>
        {data?.isAdmin && <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">Admin Panel</Link>
          <Link href="/admin/resources/new" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm motion-safe:transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"><span aria-hidden="true" className="text-lg leading-none">+</span>Add New Resource</Link>
        </div>}
      </header>

      {data ? <ResourceCatalog resources={data.resources} isAdmin={data.isAdmin} /> : <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">We couldn’t load the resource catalog. Please refresh the page to try again.</p>}
    </div>
  );
}
