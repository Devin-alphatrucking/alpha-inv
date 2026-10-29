import type { Mail } from "./transport";
import { isHexColor } from "@/lib/brand/theme";
import { displayCode } from "@/lib/security/otp-rules";

/** Everything is plain HTML tables with inline styles (the only thing email programs agree on). Every inserted value is escaped. */
export function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type MailBrand = { name: string; color?: string | null; supportEmail?: string | null };

function layout(brand: MailBrand, heading: string, bodyHtml: string, button?: { label: string; url: string }, footer?: string) {
  const color = isHexColor(brand.color) ? brand.color : "#171717";
  const btn = button
    ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:${color};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>
       <p style="color:#6b7280;font-size:13px;margin:0 0 8px">If the button does not work, copy this address into your browser:</p>
       <p style="font-size:13px;word-break:break-all;margin:0"><a href="${esc(button.url)}" style="color:${color}">${esc(button.url)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:.08em;color:${color};text-transform:uppercase">${esc(brand.name)}</p>
        <h1 style="margin:0 0 16px;font-size:20px">${esc(heading)}</h1>
        <div style="font-size:15px;line-height:1.55">${bodyHtml}</div>
        ${btn}
        <p style="color:#6b7280;font-size:12px;margin:28px 0 0">${footer ? esc(footer) : ""}${brand.supportEmail ? ` Questions? ${esc(brand.supportEmail)}.` : ""}</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const P = (t: string) => `<p style="margin:0 0 12px">${t}</p>`;

/** The big code block shown in an email. */
const CODE_BOX = (code: string) => `<p style="margin:16px 0;padding:14px 18px;background:#f3f4f6;border-radius:10px;font-size:30px;letter-spacing:.35em;font-weight:700;text-align:center;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(displayCode(code))}</p>`;

export function verifyEmailMail(to: string, d: { name: string; link: string; brand: MailBrand; code?: string }): Mail {
  const lead = d.code ? `Your confirmation code is ${displayCode(d.code)}. It works for 10 minutes.\n\nOr use this link (it works for 24 hours):` : "Confirm your email address to finish setting up your account:";
  return {
    to,
    subject: d.code ? `Confirm your email: your ${d.brand.name} code is ${displayCode(d.code)}` : `Confirm your email for ${d.brand.name}`,
    text: `Hi ${d.name},\n\n${lead}\n${d.link}\n\nIf you did not create an account, you can ignore this email.`,
    html: layout(
      d.brand,
      "Confirm your email",
      P(`Hi ${esc(d.name)},`) + (d.code ? P("Enter this code to confirm your email address. It works for 10 minutes.") + CODE_BOX(d.code) + P("Or use the button below (it works for 24 hours).") : P("Confirm your email address to finish setting up your account. The link works for 24 hours.")),
      { label: "Confirm email", url: d.link },
      "If you did not create an account, you can ignore this email.",
    ),
  };
}

/** The code that confirms a risky action (removing a person, closing the company, ...). */
export function confirmActionMail(to: string, d: { name: string; code: string; action: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Your ${d.brand.name} confirmation code is ${displayCode(d.code)}`,
    text: `Hi ${d.name},\n\nYour code to confirm "${d.action}" is ${displayCode(d.code)}. It works for 10 minutes.\n\nIf you did not try to do this, do not share the code, and change your password.`,
    html: layout(d.brand, "Confirm it is you", P(`Hi ${esc(d.name)},`) + P(`Enter this code to confirm: <strong>${esc(d.action)}</strong>. It works for 10 minutes.`) + CODE_BOX(d.code), undefined, "If you did not try to do this, do not share the code, and change your password."),
  };
}

export function accountExistsMail(to: string, d: { link: string; signInLink?: string; brand: MailBrand }): Mail {
  const signIn = d.signInLink ? `If it was you, sign in here:\n${d.signInLink}\n\nForgotten your password? Reset it here:\n${d.link}` : `If it was you, sign in or reset your password here:\n${d.link}`;
  return {
    to,
    subject: `Someone tried to create an account with your email`,
    text: `Someone used this email address to sign up for ${d.brand.name}, but you already have an account.\n\n${signIn}\n\nIf it was not you, no action is needed.`,
    html: layout(
      d.brand,
      "You already have an account",
      P(`Someone used this email address to sign up for ${esc(d.brand.name)}, but you already have an account.`) + P(d.signInLink ? `If it was you, sign in with your email and password. Forgotten it? <a href="${esc(d.link)}">Reset your password</a>. If it was not you, no action is needed.` : "If it was you, you can reset your password. If not, no action is needed."),
      d.signInLink ? { label: "Sign in", url: d.signInLink } : { label: "Reset my password", url: d.link },
    ),
  };
}

export function passwordResetMail(to: string, d: { name: string; link: string; brand: MailBrand; code?: string }): Mail {
  const lead = d.code ? `Your password reset code is ${displayCode(d.code)} (it works for 10 minutes). Enter it on the reset page with your new password.\n\nOr use this link to choose a new password (valid for 1 hour):` : "Use this link to choose a new password (valid for 1 hour):";
  return {
    to,
    subject: d.code ? `Reset your ${d.brand.name} password: your code is ${displayCode(d.code)}` : `Reset your ${d.brand.name} password`,
    text: `Hi ${d.name},\n\n${lead}\n${d.link}\n\nIf you did not ask for this, ignore this email: your password stays the same.`,
    html: layout(
      d.brand,
      "Reset your password",
      P(`Hi ${esc(d.name)},`) + (d.code ? P("Enter this code on the reset page with your new password. It works for 10 minutes.") + CODE_BOX(d.code) + P("Or use the button below to choose a new password (it works for 1 hour).") : P("Use the button below to choose a new password. The link works for 1 hour.")),
      { label: "Choose a new password", url: d.link },
      "If you did not ask for this, ignore this email: your password stays the same.",
    ),
  };
}

/** A company set up for someone by our team: the link lets them choose their own password (and confirms their address). */
export function welcomeMail(to: string, d: { name: string; company: string; link: string; days: number; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Your ${d.brand.name} account for ${d.company} is ready`,
    text: `Hi ${d.name},

We have set up ${d.company} on ${d.brand.name} for you, with you as the administrator.
Choose your password to get started (the link works for ${d.days} days):
${d.link}

If you were not expecting this, ignore this email.`,
    html: layout(d.brand, "Your account is ready", P(`Hi ${esc(d.name)},`) + P(`We have set up <strong>${esc(d.company)}</strong> on ${esc(d.brand.name)} for you, with you as the administrator.`) + P(`Choose your password to get started. The link works for ${d.days} days.`), { label: "Choose my password", url: d.link }, "If you were not expecting this, ignore this email."),
  };
}

/** Said to the person whenever our team turns off their two-step sign-in, so a wrongful reset cannot go unnoticed. */
export function twoStepResetMail(to: string, d: { name: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Two-step sign-in was turned off on your ${d.brand.name} account`,
    text: `Hi ${d.name},

Our support team turned off two-step sign-in on your account after you asked for help, and signed you out everywhere.
Sign in with your password, then turn two-step sign-in on again from your Account page.

If you did not ask for this, change your password immediately and contact support.`,
    html: layout(d.brand, "Two-step sign-in was turned off", P(`Hi ${esc(d.name)},`) + P("Our support team turned off two-step sign-in on your account after you asked for help, and signed you out everywhere.") + P("Sign in with your password, then turn two-step sign-in on again from your Account page.") + P("<strong>If you did not ask for this</strong>, change your password immediately and contact support.")),
  };
}

/** Sent to a master-console operator (and to the security contact) when their sign-in looks unusual. */
export function operatorAlertMail(to: string, d: { kind: "new_place" | "many_failures"; ip: string; when: string; email: string; brand: MailBrand }): Mail {
  const newPlace = d.kind === "new_place";
  const heading = newPlace ? "Master console sign-in from a new place" : "Repeated failed master console sign-ins";
  const body = newPlace
    ? `${d.email} signed in to the master console from an address not seen before: ${d.ip}, at ${d.when}.`
    : `There were several failed master console sign-in attempts for ${d.email}, the latest from ${d.ip} at ${d.when}.`;
  const advice = newPlace
    ? "If this was you, no action is needed. If not, remove the operator with npm run master -- remove <email> and change their password."
    : "Nothing was let in. If this was not you, someone knows or is guessing the console address; consider restricting it at your firewall.";
  return {
    to,
    subject: `${d.brand.name}: ${heading}`,
    text: `${body}\n\n${advice}`,
    html: layout(d.brand, heading, P(esc(body)) + P(esc(advice))),
  };
}

export function passwordChangedMail(to: string, d: { name: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Your ${d.brand.name} password was changed`,
    text: `Hi ${d.name},\n\nThe password for your account was just changed and all other sessions were signed out.\nIf this was not you, reset your password immediately and contact support.`,
    html: layout(d.brand, "Your password was changed", P(`Hi ${esc(d.name)},`) + P("The password for your account was just changed and all other sessions were signed out.") + P("If this was not you, reset your password immediately and contact support.")),
  };
}

/** Said to the person when an administrator sets a new password for them, so a surprise change cannot go unnoticed. */
export function passwordSetByAdminMail(to: string, d: { name: string; adminName: string; company: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Your ${d.company} password was changed by ${d.adminName}`,
    text: `Hi ${d.name},\n\n${d.adminName}, an administrator of ${d.company}, set a new password for your account and signed you out of every device.\nAsk them for the new password. You can change it again yourself on your Account page.\nIf you did not expect this, contact ${d.adminName} or reset your password from the sign-in page.`,
    html: layout(
      d.brand,
      "Your password was changed",
      P(`Hi ${esc(d.name)},`) +
        P(`<strong>${esc(d.adminName)}</strong>, an administrator of ${esc(d.company)}, set a new password for your account and signed you out of every device.`) +
        P("Ask them for the new password. You can change it again yourself on your Account page.") +
        P("If you did not expect this, contact them or reset your password from the sign-in page."),
    ),
  };
}

export function inviteMail(to: string, d: { inviterName: string; company: string; role: string; link: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `${d.inviterName} invited you to ${d.company}`,
    text: `${d.inviterName} invited you to join ${d.company} as ${d.role.toLowerCase()}.\n\nAccept the invitation here (valid for 7 days):\n${d.link}`,
    html: layout(d.brand, `Join ${d.company}`, P(`<strong>${esc(d.inviterName)}</strong> invited you to join <strong>${esc(d.company)}</strong> as ${esc(d.role.toLowerCase())}.`) + P("The invitation works for 7 days."), { label: "Accept invitation", url: d.link }, "If you were not expecting this, you can ignore it."),
  };
}

export function accountDeletedMail(to: string, d: { name: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Your ${d.brand.name} account was deleted`,
    text: `Hi ${d.name},\n\nYour account was deleted and your personal details were removed. If this was not you, contact support right away.`,
    html: layout(d.brand, "Your account was deleted", P(`Hi ${esc(d.name)},`) + P("Your account was deleted and your personal details were removed.") + P("If this was not you, contact support right away.")),
  };
}

/** To YOUR support inbox. The customer's address is the reply-to, so pressing "Reply" answers them. */
export function supportRequestMail(
  to: string,
  d: { reference: string; priority: string; subject: string; body: string; company: string; slug: string; plan: string; state: string; userName: string; userEmail: string; usage: string; brand: MailBrand }
): Mail {
  const facts: [string, string][] = [
    ["Reference", d.reference],
    ["Priority", d.priority],
    ["Company", `${d.company} (${d.slug})`],
    ["Plan", `${d.plan} (${d.state})`],
    ["Usage", d.usage],
    ["From", `${d.userName} <${d.userEmail}>`],
  ];
  return {
    to,
    replyTo: d.userEmail,
    subject: `[${d.reference}] ${d.subject}`,
    text: `${facts.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${d.body}`,
    html: layout(
      d.brand,
      d.subject,
      `<table cellpadding="0" cellspacing="0" style="font-size:13px;margin:0 0 14px">${facts
        .map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#6b7280">${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join("")}</table>` + `<div style="white-space:pre-wrap;border-left:3px solid #e5e7eb;padding-left:12px">${esc(d.body)}</div>`
    ),
  };
}

export function supportConfirmationMail(to: string, d: { name: string; reference: string; subject: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `We received your request (${d.reference})`,
    text: `Hi ${d.name},\n\nWe received your support request "${d.subject}". Your reference is ${d.reference}.\nReply to this email if you want to add anything: it goes straight to our team.`,
    html: layout(
      d.brand,
      "We received your request",
      P(`Hi ${esc(d.name)},`) +
        P(`We received your support request <strong>&ldquo;${esc(d.subject)}&rdquo;</strong>.`) +
        P(`Your reference is <strong>${esc(d.reference)}</strong>. Reply to this email if you want to add anything: it goes straight to our team.`)
    ),
  };
}

export type DigestItem = { vendor: string; number: string; project: string; balance: string; when: string };
export type DigestSection = { count: number; amount: string; items: DigestItem[] };
export type DigestBudget = { name: string; percent: number; spent: string; budget: string; over: boolean };

/** The morning email to administrators: what is overdue, what is due this week, and what is waiting for review. Amounts arrive already formatted. */
function budgetHtml(budgets: DigestBudget[]) {
  return (
    `<p style="margin:16px 0 0;font-weight:700;color:#b45309">Budget alerts</p>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:6px 0 16px">` +
    budgets
      .map(
        (b) =>
          `<tr><td style="padding:6px 0;border-top:1px solid #e5e7eb"><strong>${esc(b.name)}</strong><br><span style="color:#6b7280;font-size:12px">${esc(b.spent)} of ${esc(b.budget)}</span></td><td align="right" style="padding:6px 0;border-top:1px solid #e5e7eb;white-space:nowrap;color:${b.over ? "#b91c1c" : "#b45309"}"><strong>${Math.round(b.percent)}%${b.over ? " (over)" : ""}</strong></td></tr>`,
      )
      .join("") +
    `</table>`
  );
}

/** Sent to administrators when a trial has 3 days or less left. */
export function trialEndingMail(to: string, d: { name: string; company: string; days: number; link: string; brand: MailBrand }): Mail {
  const when = d.days <= 1 ? "tomorrow or sooner" : `in ${d.days} days`;
  return {
    to,
    subject: `${d.company}: your trial ends ${when}`,
    text: `Hi ${d.name},

The trial of ${d.company} on ${d.brand.name} ends ${when}. To keep working without a break, choose a plan:
${d.link}

Nothing is deleted if you do not. Your data stays safe and the company opens again as soon as a plan is active.`,
    html: layout(
      d.brand,
      "Your trial is ending",
      P(`Hi ${esc(d.name)},`) +
        P(`The trial of <strong>${esc(d.company)}</strong> ends <strong>${esc(when)}</strong>. To keep working without a break, choose a plan.`) +
        P("Nothing is deleted if you do not. Your data stays safe and the company opens again as soon as a plan is active."),
      { label: "Choose a plan", url: d.link },
      "You get this because you are an administrator of this company.",
    ),
  };
}

/** Sent once, to administrators, after a trial has ended without a plan. */
export function trialEndedMail(to: string, d: { name: string; company: string; link: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `${d.company}: your trial has ended`,
    text: `Hi ${d.name},

The trial of ${d.company} on ${d.brand.name} has ended, so the company is paused. Your data is safe and nothing was deleted.
Choose a plan to open it again:
${d.link}`,
    html: layout(
      d.brand,
      "Your trial has ended",
      P(`Hi ${esc(d.name)},`) +
        P(`The trial of <strong>${esc(d.company)}</strong> has ended, so the company is paused. Your data is safe and nothing was deleted.`) +
        P("Choose a plan to open it again."),
      { label: "Choose a plan", url: d.link },
      "You get this because you are an administrator of this company.",
    ),
  };
}

export function quietCheckInMail(to: string, d: { name: string; company: string; days: number; link: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `${d.company}: we have not seen you for a while`,
    text: `Hi ${d.name},

Nobody at ${d.company} has used ${d.brand.name} for ${d.days} days. Your data is safe and just as you left it.
If something got in the way or you need a hand setting up, just reply to this email.
Open it again:
${d.link}`,
    html: layout(
      d.brand,
      "Can we help?",
      P(`Hi ${esc(d.name)},`) +
        P(`Nobody at <strong>${esc(d.company)}</strong> has used ${esc(d.brand.name)} for ${d.days} days. Your data is safe and just as you left it.`) +
        P("If something got in the way or you need a hand setting up, just reply to this email."),
      { label: "Open it again", url: d.link },
      "You get this because you are an administrator of this company. We write at most once a month.",
    ),
  };
}

export function digestMail(
  to: string,
  d: { name: string; company: string; overdue: DigestSection; dueSoon: DigestSection; drafts: number; budgets?: DigestBudget[]; link: string; brand: MailBrand },
): Mail {
  const parts: string[] = [];
  if (d.overdue.count) parts.push(`${d.overdue.amount} overdue`);
  if (d.dueSoon.count) parts.push(`${d.dueSoon.amount} due this week`);
  const budgets = d.budgets ?? [];
  const over = budgets.filter((b) => b.over).length;
  if (over) parts.push(`${over} project${over === 1 ? "" : "s"} over budget`);
  else if (budgets.length) parts.push(`${budgets.length} project${budgets.length === 1 ? "" : "s"} near budget`);
  if (!parts.length && d.drafts) parts.push(`${d.drafts} waiting for review`);

  const plural = (n: number) => `${n} invoice${n === 1 ? "" : "s"}`;
  const listText = (title: string, sec: DigestSection) =>
    sec.count
      ? `${title}: ${plural(sec.count)}, ${sec.amount}\n` + sec.items.map((i) => `  - ${i.vendor} ${i.number} (${i.project}): ${i.balance}, ${i.when}`).join("\n") + (sec.count > sec.items.length ? `\n  ...and ${sec.count - sec.items.length} more` : "") + "\n\n"
      : "";
  const text =
    `Hi ${d.name},\n\nYour daily summary for ${d.company}:\n\n` +
    listText("Overdue", d.overdue) +
    listText("Due in the next 7 days", d.dueSoon) +
    (budgets.length ? `Budget alerts:\n` + budgets.map((b) => `  - ${b.name}: ${b.spent} of ${b.budget} (${Math.round(b.percent)}%${b.over ? ", over budget" : ""})`).join("\n") + "\n\n" : "") +
    (d.drafts ? `Waiting for review: ${d.drafts}\n\n` : "") +
    `Open your dashboard: ${d.link}\n\nYou get this email each morning when something needs attention. Turn it off on your Account page.`;

  const rows = (items: DigestItem[], total: number) =>
    `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:6px 0 16px">` +
    items
      .map(
        (i) =>
          `<tr><td style="padding:6px 0;border-top:1px solid #e5e7eb"><strong>${esc(i.vendor)}</strong><br><span style="color:#6b7280;font-size:12px">${esc(i.number)} · ${esc(i.project)} · ${esc(i.when)}</span></td><td align="right" style="padding:6px 0;border-top:1px solid #e5e7eb;white-space:nowrap"><strong>${esc(i.balance)}</strong></td></tr>`,
      )
      .join("") +
    (total > items.length ? `<tr><td colspan="2" style="padding:6px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px">...and ${total - items.length} more. Open your dashboard to see them all.</td></tr>` : "") +
    `</table>`;
  const section = (title: string, color: string, sec: DigestSection) =>
    sec.count
      ? `<p style="margin:16px 0 0;font-weight:700;color:${color}">${esc(title)}: ${esc(sec.amount)} <span style="font-weight:400;color:#6b7280">(${plural(sec.count)})</span></p>${rows(sec.items, sec.count)}`
      : "";

  return {
    to,
    subject: `${d.company}: ${parts.join(", ") || "daily summary"}`,
    text,
    html: layout(
      d.brand,
      "Your daily summary",
      P(`Hi ${esc(d.name)},`) +
        P(`Here is what needs attention for <strong>${esc(d.company)}</strong> today.`) +
        section("Overdue", "#b91c1c", d.overdue) +
        section("Due in the next 7 days", "#b45309", d.dueSoon) +
        (budgets.length ? budgetHtml(budgets) : "") +
        (d.drafts ? P(`<strong>${d.drafts}</strong> invoice${d.drafts === 1 ? " is" : "s are"} waiting for review.`) : ""),
      { label: "Open my dashboard", url: d.link },
      "You get this email each morning when something needs attention. Turn it off on your Account page.",
    ),
  };
}
