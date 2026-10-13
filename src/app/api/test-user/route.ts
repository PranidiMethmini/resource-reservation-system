
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Not available" },
      { status: 404 }
    );
  }

  const user = await prisma.user.findUnique({
    where: {
      email: "testuser@reservehub.local",
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!user) {
    return NextResponse.json(
      { error: "Test user not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(user);
}
