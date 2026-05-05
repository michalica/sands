import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { sendMail } from "@/lib/email";

const dbPath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "../data/sandboxjs.db");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const auth = betterAuth({
  database: sqlite,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Reset your SandboxJS password",
        text: `Hi ${user.name ?? "there"},\n\nClick this link to reset your password:\n${url}\n\nIf you didn't request this, ignore this email.`,
        html: `
          <p>Hi ${user.name ?? "there"},</p>
          <p>Click the link below to reset your password:</p>
          <p><a href="${url}">${url}</a></p>
          <p>If you didn't request this, ignore this email.</p>
        `,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Verify your SandboxJS email",
        text: `Welcome${user.name ? ", " + user.name : ""}!\n\nVerify your email by clicking:\n${url}`,
        html: `
          <p>Welcome${user.name ? ", " + user.name : ""}!</p>
          <p>Verify your email by clicking the link below:</p>
          <p><a href="${url}">${url}</a></p>
        `,
      });
    },
  },
  plugins: [apiKey()],
});
