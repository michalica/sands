import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;

if (!user || !pass) {
  console.warn(
    "[email] GMAIL_USER / GMAIL_APP_PASSWORD not set — verification and reset emails will fail.",
  );
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user, pass },
});

const from = process.env.EMAIL_FROM ?? user ?? "no-reply@example.com";

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  await transporter.sendMail({ from, ...opts });
}
