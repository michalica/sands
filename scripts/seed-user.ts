import Database from "better-sqlite3";
import { auth } from "../src/auth.js";
import { config } from "../src/config.js";

const email = process.env.SEED_EMAIL ?? "test@example.com";
const password = process.env.SEED_PASSWORD ?? "test1234";
const name = process.env.SEED_NAME ?? "Test User";

const sqlite = new Database(config.databasePath, { readonly: true });
const existing = sqlite.prepare("SELECT id FROM user WHERE email = ?").get(email) as
  | { id: string }
  | undefined;
sqlite.close();

let userId: string;

if (existing) {
  userId = existing.id;
  console.log(`User ${email} already exists (id: ${userId})`);
} else {
  const created = await auth.api.signUpEmail({ body: { email, password, name } });
  userId = created.user.id;
  console.log(`Created user ${email} (id: ${userId})`);
}

const keyRes = await auth.api.createApiKey({
  body: { name: "seed", userId },
});

console.log("");
console.log("Email:    ", email);
console.log("Password: ", password);
console.log("API key:  ", keyRes.key);
console.log("");
console.log("Try it:");
console.log(`  curl -H "Authorization: Bearer ${keyRes.key}" http://localhost:3000/sandboxes`);

process.exit(0);
