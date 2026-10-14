import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { colomboDate } from "@/lib/booking";
import BookingForm from "@/components/BookingForm";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BookResourcePage({ searchParams }: { searchParams: Promise<{ resourceId?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const params = await searchParams;
  const resourceId = typeof params.resourceId === "string" ? params.resourceId : "";
  let resources;
  try {
    resources = await prisma.resource.findMany({
      where: { isActive: true }, orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, location: true, capacity: true, isActive: true },
    });
  } catch (error) { console.error("Error loading booking resources:", error); }

  return (
    <div className="mx-auto max-w-[1440px] space-y-7 p-5 font-sans text-slate-900 sm:p-7 lg:p-9">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-3xl font-bold tracking-tight">Book a Resource</h1><p className="mt-2 text-sm leading-6 text-slate-500">Choose your resource, set your time, and we’ll take care of the reservation.</p></div></header>
      {resources ? <BookingForm key={resourceId} resources={resources} initialResourceId={resourceId} today={colomboDate(new Date())} /> : <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">We couldn’t load the resources. Please refresh the page to try again.</p>}
    </div>
  );
}
