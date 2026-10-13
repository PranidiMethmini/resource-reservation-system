
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Check whether the user is logged in
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Please sign in to cancel a reservation." },
        { status: 401 }
      );
    }

    // 2. Find the logged-in user
    const user = await prisma.user.findUnique({
      where: {
        email: session.user.email,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User account not found." },
        { status: 401 }
      );
    }

    // 3. Get reservation ID
    const { id } = await context.params;

    // 4. Validate the request
    const body = await request.json();

    if (body?.status !== "CANCELLED") {
      return NextResponse.json(
        { error: "Invalid reservation status." },
        { status: 400 }
      );
    }

    // 5. Find the reservation
    const reservation = await prisma.reservation.findUnique({
      where: {
        id,
      },
    });

    if (!reservation || reservation.userId !== user.id) {
      return NextResponse.json(
        { error: "Reservation not found." },
        { status: 404 }
      );
    }

    // 6. Check whether it is already cancelled
    if (reservation.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Reservation is already cancelled." },
        { status: 400 }
      );
    }

    // 7. Prevent cancelling past or ongoing reservations
    if (reservation.startTime <= new Date()) {
      return NextResponse.json(
        {
          error: "Past or ongoing reservations cannot be cancelled.",
        },
        { status: 400 }
      );
    }

    // 8. Cancel only if the reservation is still eligible
    const result = await prisma.reservation.updateMany({
      where: {
        id,
        userId: user.id,
        status: "CONFIRMED",
        startTime: {
          gt: new Date(),
        },
      },
      data: {
        status: "CANCELLED",
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        {
          error: "This reservation can no longer be cancelled.",
        },
        { status: 409 }
      );
    }

    // 9. Return the updated reservation
    const updatedReservation = await prisma.reservation.findUnique({
      where: {
        id,
      },
    });

    return NextResponse.json(updatedReservation);
  } catch (error) {
    console.error("Error cancelling reservation:", error);

    return NextResponse.json(
      { error: "Failed to cancel reservation." },
      { status: 500 }
    );
  }
}
