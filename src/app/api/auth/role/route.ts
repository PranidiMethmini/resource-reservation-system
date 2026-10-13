
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { role: null },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        email: session.user.email,
      },
      select: {
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { role: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { role: user.role },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Error checking user role:", error);

    return NextResponse.json(
      { error: "Failed to check user role" },
      { status: 500 }
    );
  }
}
