import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import AdminReservations from "@/components/AdminReservations";

export const dynamic = "force-dynamic";
export default async function AdminReservationsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } });
  if (user?.role !== "ADMIN") redirect("/");
  return <AdminReservations />;
}
