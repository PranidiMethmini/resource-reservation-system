import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

export const demoResources = [
  { name: "Meeting Room A", type: "Meeting Room", location: "Main Building, Floor 1", capacity: 8, description: "Small meeting space with a whiteboard for team discussions." },
  { name: "Meeting Room B", type: "Meeting Room", location: "Main Building, Floor 2", capacity: 12, description: "Meeting room with a presentation screen and conference table." },
  { name: "Conference Hall", type: "Conference Hall", location: "Main Building, Floor 2", capacity: 50, description: "Large presentation space for departmental meetings and events." },
  { name: "Computer Lab A", type: "Laboratory", location: "Technology Building, Floor 3", capacity: 30, description: "Computer workstations for practical classes and software workshops." },
  { name: "Computer Lab B", type: "Laboratory", location: "Technology Building, Floor 2", capacity: 25, description: "Computer lab for group assignments and technical training." },
  { name: "Multimedia Room", type: "Multimedia Room", location: "Library Building, Floor 1", capacity: 20, description: "Presentation and media viewing room with a display and audio system." },
  { name: "Projector 01", type: "Equipment", location: "IT Services, Main Building, Floor 1", capacity: 1, description: "Portable projector for teaching and presentations; collect from IT Services." },
  { name: "Projector 02", type: "Equipment", location: "IT Services, Technology Building, Floor 1", capacity: 1, description: "Portable projector for workshops; collect from the IT Services desk." },
  { name: "Training Room", type: "Training Room", location: "Learning Centre, Floor 2", capacity: 20, description: "Flexible seating and whiteboards for training sessions." },
  { name: "Discussion Room", type: "Discussion Room", location: "Library Building, Floor 2", capacity: 6, description: "Quiet room for small study groups and project discussions." },
  { name: "Photography Studio", type: "Studio", location: "Creative Arts Building, Ground Floor", capacity: 8, description: "Studio space with a backdrop area for photography practice." },
  { name: "Seminar Room", type: "Seminar Room", location: "Academic Building, Floor 1", capacity: 40, description: "Seminar room with seating and a presentation screen." },
];

export async function seedResources(client) {
  await client.query("BEGIN");
  try {
    // Names are not unique in the schema. Serialize the check/insert sequence
    // against other resource writes, including concurrent seed executions.
    await client.query('LOCK TABLE public."Resource" IN SHARE ROW EXCLUSIVE MODE');
    const existing = (await client.query('SELECT name FROM public."Resource"')).rows;
    const names = new Set(existing.map((item) => item.name.trim().toLowerCase()));
    let inserted = 0;
    for (const resource of demoResources) {
      const name = resource.name.trim().toLowerCase();
      if (names.has(name)) continue;
      await client.query('INSERT INTO public."Resource" (id, name, type, location, capacity, description, "isActive", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [randomUUID(), resource.name, resource.type, resource.location, resource.capacity, resource.description]);
      names.add(name); inserted++;
    }
    await client.query("COMMIT");
    return { inserted, skipped: demoResources.length - inserted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  dotenv.config({ path: resolve(root, ".env"), quiet: true });
  const connectionString = process.env.DATABASE_URL;
  const localPath = resolve(root, ".env.local");
  const localUrl = existsSync(localPath) ? dotenv.parse(readFileSync(localPath)).DATABASE_URL : undefined;
  const url = new URL(connectionString);
  if (process.env.NODE_ENV === "production" || (localUrl && localUrl !== connectionString) || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== "reservehub_db") throw new Error("Unsafe seed target");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const row = (await client.query("SELECT current_database() AS database, host(inet_server_addr()) AS address")).rows[0];
    if (row.database !== "reservehub_db" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(row.address)) throw new Error("Unsafe seed target");
    console.log(JSON.stringify({ database: "local reservehub_db", ...await seedResources(client) }));
  } finally { await client.end(); }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Resource seed failed or target was unsafe. Connection details suppressed."); process.exitCode = 1; });
}
