import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import ResourceForm from "@/components/ResourceForm";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } });
  if (user?.role !== "ADMIN") redirect("/");
  const { id } = await params;
  let resource;
  let failed = false;
  try { resource = await prisma.resource.findUnique({ where: { id }, select: { id: true, name: true, type: true, location: true, capacity: true, description: true, isActive: true } }); }
  catch (error) { console.error("Error loading resource for editing:", error); failed = true; }
  return <div className="mx-auto max-w-[1440px] space-y-7 p-5 font-sans text-slate-900 sm:p-7 lg:p-9"><header><p className="mb-2 text-xs font-semibold tracking-[0.18em] text-indigo-600">RESOURCE MANAGEMENT</p><h1 className="text-3xl font-bold tracking-tight">Edit Resource</h1><p className="mt-2 text-sm leading-6 text-slate-500">Keep resource details accurate and manage new-booking access.</p></header>{resource ? <ResourceForm key={id} initial={resource} /> : <section role={failed ? "alert" : undefined} className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><h2 className="text-xl font-semibold">{failed ? "Unable to load this resource" : "Resource not found"}</h2><p className="mt-3 text-sm text-slate-500">{failed ? "Please refresh the page to try again." : "This link may be incorrect. Choose a resource from the catalog."}</p><Link href="/resources" className="mt-6 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">Back to Resources</Link></section>}</div>;
}
