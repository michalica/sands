import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sandboxes = sqliteTable("sandboxes", {
  sandboxId: text("sandbox_id").primaryKey(),
  userId: text("user_id"),
  templateId: text("template_id").notNull().default("node-22"),
  networkPolicy: text("network_policy").notNull().default('{"enabled":false,"allowed":[],"disallowed":[]}'),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at").notNull(),
  status: text("status", { enum: ["running", "destroyed"] }).notNull().default("running"),
  destroyedAt: integer("destroyed_at"),
});

export const executionLogs = sqliteTable("execution_logs", {
  executionId: text("execution_id").primaryKey(),
  sandboxId: text("sandbox_id").notNull().references(() => sandboxes.sandboxId),
  timestamp: integer("timestamp").notNull(),
  code: text("code").notNull(),
  result: text("result").notNull(), // JSON-serialized ExecutionResult
});

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  rootfsPath: text("rootfs_path").notNull(),
  kernelPath: text("kernel_path").notNull(),
  defaultPackages: text("default_packages").notNull(),
  buildMeta: text("build_meta").notNull(),
});
