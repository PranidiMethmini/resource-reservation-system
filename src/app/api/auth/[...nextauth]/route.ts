import { handlers } from "@/auth";
import type { NextRequest } from "next/server";
import { withAuthRateLimitResponse } from "@/lib/auth-rate-limit-response";

export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  return withAuthRateLimitResponse(request, () => handlers.POST(request));
}
