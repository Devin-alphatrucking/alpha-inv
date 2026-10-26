import type { RoleName } from "@/lib/roles";
import { z } from "zod";
import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { sendMail } from "@/lib/email/transport";
import { supportConfirmationMail, supportRequestMail } from "@/lib/email/templates";
import { getEntitlements } from "@/lib/plans/entitlements";
import { ticketPriority } from "@/lib/plans/rules";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { firstIssue, type FlowResult } from "@/lib/flows/schemas";

/** Where support requests are emailed (SUPPORT_EMAIL). Tickets are saved even if this is not set. */
export function supportAddress() {
  const v = process.env.SUPPORT_EMAIL?.trim();
  return v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

export const ticketReference = (n: number) => `SUP-${String(n).padStart(6, "0")}`;

const ticketSchema = z.object({
  subject: z.string().trim().min(3, "Give your request a short title (at least 3 characters).").max(120, "Keep the title under 120 characters."),
  message: z.string().trim().min(10, "Describe the problem in at least 10 characters.").max(5000, "Keep the message under 5000 characters."),
});

export type TicketUser = { id: string; name: string; email: string; orgId: string };

/**
 * A customer raises a support request from the app. It is saved as a ticket with a reference number,
 * emailed to the support inbox (with the company, plan and usage already included, reply-to = the customer),
 * and confirmed to the customer by email. Replies then continue in email.
 */
export async function createTicket(user: TicketUser, raw: unknown): Promise<FlowResult<{ number: number; reference: string; emailed: boolean }>> {
  const parsed = ticketSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const v = parsed.data;

  const limit = await hitAll([
    { key: limitKey("ticket:user", user.id), limit: 5, windowSeconds: 3600 },
    { key: limitKey("ticket:org", user.orgId), limit: 30, windowSeconds: 86400 },
  ]);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };

  const [org, e] = await Promise.all([
    rawDb.organization.findUniqueOrThrow({ where: { id: user.orgId }, select: { name: true, displayName: true, slug: true, primaryColor: true } }),
    getEntitlements(user.orgId),
  ]);
  const priority = ticketPriority(e.state);

  const ticket = await dbFor(user.orgId).supportTicket.create({
    data: {
      organizationId: user.orgId,
      userId: user.id,
      name: user.name,
      email: user.email,
      subject: v.subject,
      body: v.message,
      priority,
      planCode: e.planCode,
    },
  });
  const reference = ticketReference(ticket.number);

  const to = supportAddress();
  let emailed = false;
  if (to) {
    const company = org.displayName || org.name;
    const sent = await sendMail(
      supportRequestMail(to, {
        reference,
        priority,
        subject: v.subject,
        body: v.message,
        company,
        slug: org.slug,
        plan: e.planName ? `${e.planName} x ${e.quantity}` : "no plan",
        state: e.state,
        userName: user.name,
        userEmail: user.email,
        usage: `${e.usage.projects}/${e.limits.projects} projects, ${e.usage.users + e.usage.pendingInvites}/${e.limits.users} people`,
        brand: { name: PRODUCT_NAME },
      })
    );
    emailed = sent.ok;
  }
  // The customer always gets a confirmation with the reference (even if the support inbox is not configured yet).
  await sendMail(supportConfirmationMail(user.email, { name: user.name, reference, subject: v.subject, brand: { name: PRODUCT_NAME } }));

  await logActivity({ userId: user.id, organizationId: user.orgId, action: "TICKET_CREATED", module: "COMPANY", entityId: ticket.id, details: { reference, priority } });
  return { ok: true, number: ticket.number, reference, emailed };
}

/** Tickets a person may see: administrators see their whole company's, everyone else only their own. */
export async function listTickets(user: { id: string; orgId: string; role: RoleName }, limit = 25) {
  const rows = await dbFor(user.orgId).supportTicket.findMany({
    where: user.role === "ADMIN" ? {} : { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true, resolvedAt: true, name: true },
  });
  return rows.map((r) => ({ ...r, reference: ticketReference(r.number) }));
}

/** A ready-made `mailto:` link: the customer's mail program opens with the details support always asks for. */
export function supportMailto(address: string, ctx: { company: string; slug: string; plan: string; userName: string; userEmail: string }) {
  const subject = `Support request: ${ctx.company} (${ctx.slug})`;
  const body = `Please describe what you need help with:\n\n\n\n---- details (please keep) ----\nCompany: ${ctx.company} (${ctx.slug})\nPlan: ${ctx.plan}\nName: ${ctx.userName}\nEmail: ${ctx.userEmail}\n`;
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
