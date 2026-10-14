import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const exports = {};
const code = ts.transpileModule(readFileSync(new URL("../src/lib/resource-lock.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
runInNewContext(code, { exports });
export const resourceLockModule = exports;

// Simple transaction fixture for existing validation tests, not a PostgreSQL
// concurrency model. The separate coordination tests simulate lock ordering.
export function withMockTransactions(prisma) {
  prisma.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, "ReadCommitted");
    const tx = {
      ...prisma,
      $executeRaw: async () => 0,
      $queryRaw: async (strings, id) => {
        assert.ok(strings.join("?").includes("FOR UPDATE"));
        const row = await prisma.resource.findUnique({ where: { id } });
        return row ? [{ id, isActive: row.isActive }] : [];
      },
    };
    return callback(tx);
  };
  return prisma;
}
