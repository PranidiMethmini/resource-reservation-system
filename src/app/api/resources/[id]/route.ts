
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

// Check whether the current user has admin permission
async function checkAdminAccess() {
  const session = await auth();

  if (!session?.user?.email) {
    return {
      error: NextResponse.json(
        { error: "Please sign in to manage resources." },
        { status: 401 }
      ),
    };
  }

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
    return {
      error: NextResponse.json(
        { error: "User account not found." },
        { status: 401 }
      ),
    };
  }

  if (user.role !== "ADMIN") {
    return {
      error: NextResponse.json(
        {
          error: "Access denied. Admin permission is required.",
        },
        { status: 403 }
      ),
    };
  }

  return { error: null };
}

// Update an existing resource
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Check admin permission
    const access = await checkAdminAccess();

    if (access.error) {
      return access.error;
    }

    // 2. Get resource ID and request body
    const { id } = await context.params;
    const body = await request.json();

    const {
      name,
      description,
      type,
      location,
      capacity,
      isActive,
    } = body;

    // 3. Validate resource details
    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof type !== "string" ||
      !type.trim() ||
      typeof location !== "string" ||
      !location.trim() ||
      !Number.isInteger(capacity) ||
      capacity <= 0 ||
      (description !== undefined &&
        typeof description !== "string") ||
      typeof isActive !== "boolean"
    ) {
      return NextResponse.json(
        { error: "Invalid resource details" },
        { status: 400 }
      );
    }

    // 4. Check whether the resource exists
    const existingResource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!existingResource) {
      return NextResponse.json(
        { error: "Resource not found" },
        { status: 404 }
      );
    }

    // 5. Update the resource
    const updatedResource = await prisma.resource.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        type: type.trim(),
        location: location.trim(),
        capacity,
        isActive,
      },
    });

    return NextResponse.json(updatedResource);
  } catch (error) {
    console.error("Error updating resource:", error);

    return NextResponse.json(
      { error: "Failed to update resource" },
      { status: 500 }
    );
  }
}

// Deactivate an existing resource
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Check admin permission
    const access = await checkAdminAccess();

    if (access.error) {
      return access.error;
    }

    // 2. Get resource ID
    const { id } = await context.params;

    // 3. Check whether the resource exists
    const existingResource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!existingResource) {
      return NextResponse.json(
        { error: "Resource not found" },
        { status: 404 }
      );
    }

    // 4. Prevent unnecessary updates
    if (!existingResource.isActive) {
      return NextResponse.json(
        { error: "Resource is already deactivated." },
        { status: 400 }
      );
    }

    // 5. Soft delete: keep the resource in the database
    const resource = await prisma.resource.update({
      where: { id },
      data: {
        isActive: false,
      },
    });

    return NextResponse.json({
      message: "Resource deactivated successfully",
      resource,
    });
  } catch (error) {
    console.error("Error deactivating resource:", error);

    return NextResponse.json(
      { error: "Failed to deactivate resource" },
      { status: 500 }
    );
  }
}
