import { randomUUID } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";
import { loginSchema, registerSchema } from "../src/lib/auth-validation.ts";

export function validateTarget(connectionString, environment, localUrl) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error("Configure a valid local DATABASE_URL in .env."); }
  if (environment === "production" || !["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== "reservehub_db" || (localUrl && localUrl !== connectionString)) {
    throw new Error("Provisioning requires local reservehub_db, non-production mode, and consistent environment files.");
  }
}

export async function provision(client, input, hash = bcrypt.hash) {
  const email = loginSchema.shape.email.parse(input.email);
  if (!["create", "promote"].includes(input.mode)) throw new Error("Choose create or promote.");
  if (input.confirmation !== `ADMIN ${email}`) throw new Error("Confirmation did not match; no changes made.");
  let details;
  let passwordHash;
  if (input.mode === "create") {
    details = registerSchema.parse({ name: input.name, email, password: input.password });
    if (input.password !== input.confirmPassword) throw new Error("Passwords do not match.");
    passwordHash = await hash(details.password, 12);
  }
  await client.query("BEGIN");
  try {
    const rows = (await client.query('SELECT id, role FROM public."User" WHERE email = $1 FOR UPDATE', [email])).rows;
    if (input.mode === "create") {
      if (rows.length) throw new Error("Email already exists. Use promote for an existing USER; existing ADMIN accounts are left unchanged.");
      const result = await client.query('INSERT INTO public."User" (id, name, email, "passwordHash", role, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,\'ADMIN\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [randomUUID(), details.name, email, passwordHash]);
      if (result.rowCount !== 1) throw new Error("Expected exactly one inserted account.");
    } else {
      if (rows.length !== 1 || rows[0].role !== "USER") throw new Error("Promotion requires exactly one existing USER. ADMIN accounts are left unchanged.");
      const result = await client.query('UPDATE public."User" SET role = \'ADMIN\' WHERE id = $1 AND email = $2 AND role = \'USER\'', [rows[0].id, email]);
      if (result.rowCount !== 1) throw new Error("Account changed during provisioning; retry after review.");
    }
    const verified = (await client.query('SELECT role FROM public."User" WHERE email = $1', [email])).rows;
    if (verified.length !== 1 || verified[0].role !== "ADMIN") throw new Error("ADMIN verification failed.");
    await client.query("COMMIT");
    return input.mode;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") throw new Error("Email already exists; no account changed.");
    throw error;
  }
}

function hiddenPassword(label) {
  return new Promise((resolvePassword, reject) => {
    const input = process.stdin;
    let value = "";
    process.stdout.write(label);
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    const finish = () => { input.off("keypress", onKey); input.setRawMode(false); input.pause(); process.stdout.write("\n"); };
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === "c") { finish(); reject(new Error("Cancelled; no changes made.")); }
      else if (key.name === "return" || key.name === "enter") { finish(); resolvePassword(value); }
      else if (key.name === "backspace") value = Array.from(value).slice(0, -1).join("");
      else if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    input.on("keypress", onKey);
  });
}

export async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") throw new Error("Run in an interactive local terminal supporting hidden input. Redirected input is not supported.");
  if (process.argv.length > 2) throw new Error("No arguments accepted. Use interactive prompts; never pass passwords on the command line.");
  const root = fileURLToPath(new URL("../", import.meta.url));
  dotenv.config({ path: resolve(root, ".env"), quiet: true });
  const localFile = resolve(root, ".env.local");
  validateTarget(process.env.DATABASE_URL, process.env.NODE_ENV, existsSync(localFile) ? dotenv.parse(readFileSync(localFile)).DATABASE_URL : undefined);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const identity = (await client.query("SELECT current_database() AS database, host(inet_server_addr()) AS address")).rows[0];
    if (identity?.database !== "reservehub_db" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(identity.address)) throw new Error("Database identity is not verified local reservehub_db.");
    const ask = async (label) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(label); } finally { rl.close(); } };
    console.log("Local reservehub_db verified. Create a new ADMIN or promote a registered USER. Promotion preserves password and all other fields.");
    const mode = (await ask("Operation (create/promote): ")).trim();
    if (!["create", "promote"].includes(mode)) throw new Error("Choose create or promote.");
    const email = loginSchema.shape.email.parse(await ask("Email: "));
    const input = { mode, email };
    if (mode === "create") {
      input.name = await ask("Full name: ");
      console.log("Password: at least 8 characters, at most 72 UTF-8 bytes. Input is hidden.");
      input.password = await hiddenPassword("Password: ");
      input.confirmPassword = await hiddenPassword("Confirm password: ");
    }
    input.confirmation = await ask(`Type ADMIN ${email} to confirm: `);
    await provision(client, input);
    console.log(mode === "create" ? "One ADMIN account created successfully." : "One USER promoted to ADMIN. Password and other fields preserved.");
    console.log("Sign out and sign in again to refresh the session.");
  } finally { await client.end(); }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Validation messages are safe; database/connection errors may contain secrets.
    const message = error?.name === "ZodError" ? "Invalid input. Check email, name length (2-100), and password requirements." : error?.code || error?.severity ? "Database operation failed; connection details suppressed." : error.message;
    console.error(message || "Provisioning failed; details suppressed.");
    process.exitCode = 1;
  });
}
