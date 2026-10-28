import { z } from "zod";
import { ROLES } from "@/lib/roles";
import { checkPassword } from "@/lib/security/password";
import { COUNTRY_CODES } from "@/lib/org/starter-data";
import { normalizePhone } from "@/lib/security/phone";

// Input rules for the account flows. Pure, so they are unit-tested without a server.

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(160);
const person = z.string().trim().min(1, "Enter your name").max(80);

export const passwordField = (ctx?: { email?: string; name?: string }) =>
  z.string().superRefine((value, issue) => {
    const problem = checkPassword(value, ctx);
    if (problem) issue.addIssue({ code: "custom", message: problem });
  });

export const signUpSchema = z
  .object({
    companyName: z.string().trim().min(2, "Enter your company name").max(80),
    name: person,
    email,
    password: z.string(),
    phone: z.string({ message: "Enter your mobile number" }),
    country: z.enum(COUNTRY_CODES, { message: "Choose your country" }),
    acceptTerms: z.literal(true, { message: "Please accept the terms to continue" }),
  })
  .superRefine((v, issue) => {
    const problem = checkPassword(v.password, { email: v.email, name: v.name });
    if (problem) issue.addIssue({ code: "custom", path: ["password"], message: problem });
    const phone = normalizePhone(v.phone, v.country);
    if (!phone.ok) issue.addIssue({ code: "custom", path: ["phone"], message: phone.error });
  });

export const emailOnlySchema = z.object({ email });

export const resetSchema = z.object({ token: z.string().min(20).max(100), password: z.string() });

export const inviteSchema = z.object({
  email,
  role: z.enum(ROLES),
  projectIds: z.array(z.string().min(1).max(64)).max(200).default([]),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().max(80).optional(),
  password: z.string().optional(),
  phone: z.string().max(40).optional(),
  acceptTerms: z.boolean().optional(),
});

export type FlowResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

export function firstIssue(error: z.ZodError): { error: string; field?: string } {
  const issue = error.issues[0];
  return { error: issue?.message ?? "Please check the form.", field: issue?.path?.[0] as string | undefined };
}
