
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  try {
    const resources = await prisma.resource.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(resources);
  } catch (error) {
    console.error("Error fetching resources:", error);

    return NextResponse.json(
      { error: "Failed to fetch resources" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // 1. Check whether the user is logged in
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Please sign in to create resources." },
        { status: 401 }
      );
    }

    // 2. Get the logged-in user's role from the database
    const user = await prisma.user.findUnique({
      where: {
        email: session.user.email,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User account not found." },
        { status: 401 }
      );
    }

    // 3. Only admins can create resources
    if (user.role !== "ADMIN") {
      return NextResponse.json(
        {
          error: "Access denied. Admin permission is required.",
        },
        { status: 403 }
      );
    }

    // 4. Validate the request body
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid resource details" }, { status: 400 });
    }

    const { name, description, type, location, capacity } = body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100 ||
      typeof type !== "string" ||
      !type.trim() ||
      type.trim().length > 100 ||
      typeof location !== "string" ||
      !location.trim() ||
      location.trim().length > 200 ||
      !Number.isInteger(capacity) ||
      capacity <= 0 ||
      capacity > 2147483647 ||
      (description !== undefined &&
        (typeof description !== "string" || description.trim().length > 2000))
    ) {
      return NextResponse.json(
        { error: "Invalid resource details" },
        { status: 400 }
      );
    }

    // 5. Create the resource
    const resource = await prisma.resource.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        type: type.trim(),
        location: location.trim(),
        capacity,
      },
    });

    return NextResponse.json(resource, {
      status: 201,
    });
  } catch (error) {
    console.error("Error creating resource:", error);

    return NextResponse.json(
      { error: "Failed to create resource" },
      { status: 500 }
    );
  }
}
