import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sandboxes = sqliteTable("sandboxes", {
  sandboxId: text("sandbox_id").primaryKey(),
  userId: text("user_id"),
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
