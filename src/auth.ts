import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { config } from "./config.js";

const sqlite = new Database(config.databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is required");
}

export const auth = betterAuth({
  database: sqlite,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  emailAndPassword: { enabled: true },
  plugins: [apiKey()],
});
