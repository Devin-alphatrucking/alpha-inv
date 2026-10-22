import fs from "node:fs/promises";
import path from "node:path";

export type Mail = { to: string; subject: string; text: string; html: string; replyTo?: string };

/**
 * How mail leaves the server.
 *  - smtp: any SMTP provider (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM)
 *  - file: development only. Appends each mail as a JSON line to EMAIL_FILE (default .data/outbox.jsonl)
 *  - none: nothing is configured. Features that need email report that clearly.
 * EMAIL_TRANSPORT forces a choice; otherwise SMTP_HOST selects smtp, non-production selects file.
 */
export type TransportName = "smtp" | "file" | "none";

export function transportName(): TransportName {
  const forced = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (forced === "smtp" || forced === "file" || forced === "none") return forced;
  if (process.env.SMTP_HOST?.trim()) return "smtp";
  if (process.env.NODE_ENV !== "production") return "file";
  return "none";
}

export function isEmailConfigured() {
  return transportName() !== "none";
}

export function fromAddress() {
  return process.env.EMAIL_FROM?.trim() || "Invoice & Billing <no-reply@localhost>";
}

export async function deliver(mail: Mail): Promise<void> {
  const name = transportName();
  if (name === "none") throw new Error("Email is not configured on this server.");

  if (name === "file") {
    const file = process.env.EMAIL_FILE?.trim() || path.join(process.cwd(), ".data", "outbox.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify({ at: new Date().toISOString(), from: fromAddress(), ...mail }) + "\n", "utf8");
    return;
  }

  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({ from: fromAddress(), to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html });
}

/** Sends a mail and never throws: a mail problem must not break the page that asked for it. */
export async function sendMail(mail: Mail): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deliver(mail);
    return { ok: true };
  } catch (error) {
    // Never log the body: it contains one-time links.
    console.error(`[email] could not send "${mail.subject}":`, (error as Error).message);
    return { ok: false, error: (error as Error).message };
  }
}
