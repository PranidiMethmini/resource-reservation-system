import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { registerSchema } from "@/lib/auth-validation";
import { checkRegistrationLimit } from "@/lib/auth-rate-limit";

// New and duplicate registrations have the same status, body and cache policy.
// Do not return a user record or disclose whether this address already exists.
function registrationAccepted() {
  return NextResponse.json(
    { message: "Registration request processed. Please try signing in." },
    { status: 201, headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: Request) {
  try {
    const limit = await checkRegistrationLimit(request);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: limit.status === 429 ? "Too many registration attempts. Please try again later." : "Registration is temporarily unavailable. Please try again shortly." },
        { status: limit.status, headers: { "Retry-After": String(limit.retryAfter), "Cache-Control": "private, no-store" } }
      );
    }

    const body = await request.json().catch(() => null);

    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please provide valid registration details." },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    // Always hash valid submissions, including duplicates. The unique index
    // handles duplicate and racing inserts without overwriting an account.
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "USER",
      },
      select: {
        id: true,
      },
    });

    return registrationAccepted();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return registrationAccepted();
    }
    console.error("Registration failed.");

    return NextResponse.json(
      { error: "Unable to create account." },
      { status: 500 }
    );
  }
}
