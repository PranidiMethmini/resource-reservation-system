import type { Prisma } from "@/generated/prisma/client";

export const resourceTransactionOptions = {
  isolationLevel: "ReadCommitted" as const,
  maxWait: 2000,
  timeout: 8000,
};

// All resource mutations and booking creation take this one row lock first.
// Exclusive locks avoid lock upgrades and serialize only the same resource.
export async function lockResource(tx: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">, id: string) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
  await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
  const rows = await tx.$queryRaw<{ id: string; isActive: boolean }[]>`
    SELECT "id", "isActive" FROM "public"."Resource"
    WHERE "id" = ${id} FOR UPDATE
  `;
  return rows[0] ?? null;
}

export function isResourceTransactionBusy(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  const codes = new Set(["55P03", "57014", "P2028", "P2034"]);
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    const details = current as Record<string, unknown>;
    if (codes.has(String(details.code)) || codes.has(String(details.originalCode))) return true;
    for (const key of ["cause", "meta", "driverAdapterError", "database_error"]) pending.push(details[key]);
  }
  return false;
}
