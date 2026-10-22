import type { Mail } from "./transport";
import { isHexColor } from "@/lib/brand/theme";

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

export function verifyEmailMail(to: string, d: { name: string; link: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Confirm your email for ${d.brand.name}`,
    text: `Hi ${d.name},\n\nConfirm your email address to finish setting up your account:\n${d.link}\n\nThe link works for 24 hours. If you did not create an account, you can ignore this email.`,
    html: layout(d.brand, "Confirm your email", P(`Hi ${esc(d.name)},`) + P("Confirm your email address to finish setting up your account. The link works for 24 hours."), { label: "Confirm email", url: d.link }, "If you did not create an account, you can ignore this email."),
  };
}

export function accountExistsMail(to: string, d: { link: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Someone tried to create an account with your email`,
    text: `Someone used this email address to sign up for ${d.brand.name}, but you already have an account.\n\nIf it was you, sign in or reset your password here:\n${d.link}\n\nIf it was not you, no action is needed.`,
    html: layout(d.brand, "You already have an account", P(`Someone used this email address to sign up for ${esc(d.brand.name)}, but you already have an account.`) + P("If it was you, you can reset your password. If not, no action is needed."), { label: "Reset my password", url: d.link }),
  };
}

export function passwordResetMail(to: string, d: { name: string; link: string; brand: MailBrand }): Mail {
  return {
    to,
    subject: `Reset your ${d.brand.name} password`,
    text: `Hi ${d.name},\n\nUse this link to choose a new password (valid for 1 hour):\n${d.link}\n\nIf you did not ask for this, ignore this email: your password stays the same.`,
    html: layout(d.brand, "Reset your password", P(`Hi ${esc(d.name)},`) + P("Use the button below to choose a new password. The link works for 1 hour."), { label: "Choose a new password", url: d.link }, "If you did not ask for this, ignore this email: your password stays the same."),
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
