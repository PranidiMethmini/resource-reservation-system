import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers });
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 401, headers });
    if (user.role !== "ADMIN") return NextResponse.json({ error: "Admin permission required." }, { status: 403, headers });
    const reservations = await prisma.reservation.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true, resourceId: true, startTime: true, endTime: true, status: true, createdAt: true,
        resource: { select: { name: true, type: true, location: true } },
        user: { select: { name: true, email: true } },
      },
    });
    return NextResponse.json(reservations, { headers });
  } catch {
    return NextResponse.json({ error: "Unable to load reservations." }, { status: 500, headers });
  }
}
