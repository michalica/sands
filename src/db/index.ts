import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { templates } from "./schema.js";
import { sql } from "drizzle-orm";
import { config } from "../config.js";

export type Db = ReturnType<typeof drizzle>;

export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite);

  // Create tables if they don't exist
  db.run(sql`
    CREATE TABLE IF NOT EXISTS sandboxes (
      sandbox_id TEXT PRIMARY KEY,
      user_id TEXT,
      template_id TEXT NOT NULL DEFAULT 'node-22',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      destroyed_at INTEGER
    )
  `);

  // Additive migration: pre-existing databases may not have user_id yet.
  const cols = sqlite.prepare("PRAGMA table_info(sandboxes)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "user_id")) {
    db.run(sql`ALTER TABLE sandboxes ADD COLUMN user_id TEXT`);
  }
  if (!cols.some((c) => c.name === "template_id")) {
    db.run(sql`ALTER TABLE sandboxes ADD COLUMN template_id TEXT NOT NULL DEFAULT 'node-22'`);
  }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS execution_logs (
      execution_id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL REFERENCES sandboxes(sandbox_id),
      timestamp INTEGER NOT NULL,
      code TEXT NOT NULL,
      result TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      rootfs_path TEXT NOT NULL,
      kernel_path TEXT NOT NULL,
      default_packages TEXT NOT NULL,
      build_meta TEXT NOT NULL
    )
  `);

  const seedTemplates = [
    {
      id: "node-22",
      name: "Node.js 22",
      version: "22",
      rootfsPath: config.rootfsPath,
      kernelPath: config.kernelImagePath,
      defaultPackages: JSON.stringify(["node"]),
      buildMeta: JSON.stringify({ seeded: true }),
    },
    {
      id: "python-3.12",
      name: "Python 3.12",
      version: "3.12",
      rootfsPath: config.rootfsPath,
      kernelPath: config.kernelImagePath,
      defaultPackages: JSON.stringify(["python3", "pip"]),
      buildMeta: JSON.stringify({ seeded: true }),
    },
    {
      id: "browser-chromium",
      name: "Browser Chromium",
      version: "chromium",
      rootfsPath: config.rootfsPath,
      kernelPath: config.kernelImagePath,
      defaultPackages: JSON.stringify(["chromium"]),
      buildMeta: JSON.stringify({ seeded: true }),
    },
  ];

  for (const template of seedTemplates) {
    db.insert(templates).values(template).onConflictDoNothing().run();
  }

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_logs_sandbox ON execution_logs(sandbox_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sandboxes_last_used ON sandboxes(last_used_at)`);

  return db;
}
