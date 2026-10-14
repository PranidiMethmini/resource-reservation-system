
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { z } from "zod";
import { lockResource, resourceTransactionOptions, isResourceTransactionBusy } from "@/lib/resource-lock";

// PrismaPg can wrap PostgreSQL errors in cause or Prisma error metadata.
function isReservationConflict(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }

    visited.add(current);
    const details = current as Record<string, unknown>;
    if (details.code === "23P01" || details.originalCode === "23P01") {
      return true;
    }

    for (const key of ["cause", "meta", "driverAdapterError", "database_error"]) {
      pending.push(details[key]);
    }
  }

  return false;
}

async function getCurrentUser() {
  const session = await auth();

  if (!session?.user?.email) {
    return null;
  }

  return prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Please sign in to view reservations." },
        { status: 401 }
      );
    }

    const reservations = await prisma.reservation.findMany({
      where: {
        userId: user.id,
      },
      include: {
        resource: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        startTime: "asc",
      },
    });

    return NextResponse.json(reservations);
  } catch (error) {
    console.error("Error fetching reservations:", error);

    return NextResponse.json(
      { error: "Failed to fetch reservations" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Please sign in to book a resource." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid reservation details" }, { status: 400 });
    }

    const { resourceId, startTime, endTime } = body;

    if (
      typeof resourceId !== "string" ||
      !resourceId.trim() ||
      resourceId.length > 200 ||
      typeof startTime !== "string" ||
      typeof endTime !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid reservation details" },
        { status: 400 }
      );
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (
      !z.iso.datetime({ offset: true }).safeParse(startTime).success ||
      !z.iso.datetime({ offset: true }).safeParse(endTime).success ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end
    ) {
      return NextResponse.json(
        { error: "Invalid reservation time range" },
        { status: 400 }
      );
    }

    if (start <= new Date()) {
      return NextResponse.json(
        { error: "Reservations must be in the future" },
        { status: 400 }
      );
    }

    return await prisma.$transaction(async (tx) => {
      const resource = await lockResource(tx, resourceId);

      if (!resource || !resource.isActive) {
        return NextResponse.json(
          { error: "Resource is unavailable" },
          { status: 404 }
        );
      }

      if (start <= new Date()) {
        return NextResponse.json({ error: "Reservations must be in the future" }, { status: 400 });
      }

      const overlappingReservation =
        await tx.reservation.findFirst({
          where: {
            resourceId,
            status: "CONFIRMED",
            startTime: {
              lt: end,
            },
            endTime: {
              gt: start,
            },
          },
        });

      if (overlappingReservation) {
        return NextResponse.json(
          {
            error:
              "This resource is already booked for the selected time.",
          },
          { status: 409 }
        );
      }

      if (start <= new Date()) {
        return NextResponse.json({ error: "Reservations must be in the future" }, { status: 400 });
      }

      const reservation = await tx.reservation.create({
        data: {
          userId: user.id,
          resourceId,
          startTime: start,
          endTime: end,
          status: "CONFIRMED",
        },
      });

      return NextResponse.json(reservation, {
        status: 201,
      });
    }, resourceTransactionOptions);
  } catch (error) {
    if (isReservationConflict(error)) {
      return NextResponse.json(
        { error: "This resource is already booked for the selected time." },
        { status: 409 }
      );
    }

    if (isResourceTransactionBusy(error)) {
      return NextResponse.json({ error: "This resource is busy. Please try again shortly." }, { status: 503, headers: { "Retry-After": "1" } });
    }

    console.error("Error creating reservation:", error);

    return NextResponse.json(
      { error: "Failed to create reservation" },
      { status: 500 }
    );
  }
}
