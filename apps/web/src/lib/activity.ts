import { rawDb } from "@/lib/db";

export type ActivityModule =
  | "AUTH"
  | "USER"
  | "PROJECT"
  | "INVOICE"
  | "PAYMENT"
  | "VENDOR"
  | "CATEGORY"
  | "COMPANY"
  | "BILLING"
  | "MASTER";

export type ActivityAction =
  | "LOGIN"
  | "LOGOUT"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DELETED"
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "PROJECT_ASSIGNED"
  | "PROJECT_NOTE_ADDED"
  | "INVOICE_UPLOADED"
  | "INVOICE_CREATED"
  | "INVOICE_UPDATED"
  | "INVOICE_DELETED"
  | "PAYMENT_CREATED"
  | "PAYMENT_DELETED"
  | "CATEGORY_CREATED"
  | "VENDOR_CREATED"
  | "VENDOR_DELETED"
  | "COMPANY_UPDATED"
  | "COMPANY_CLOSED"
  | "USER_SIGNED_UP"
  | "EMAIL_VERIFIED"
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGED"
  | "SESSIONS_REVOKED"
  | "USER_INVITED"
  | "INVITE_ACCEPTED"
  | "INVITE_REVOKED"
  | "ACCOUNT_DELETED"
  | "COMPANY_SWITCHED"
  | "TICKET_CREATED"
  | "BILLING_STARTED"
  | "BILLING_CHANGED"
  | "BILLING_CANCELED"
  | "MASTER_VIEWED_COMPANY"
  | "MASTER_GRANTED_PLANS"
  | "MASTER_EXTENDED_TRIAL"
  | "MASTER_SET_LIMITS"
  | "MASTER_SET_COMPANY_STATUS"
  | "MASTER_EDITED_PLAN"
  | "MASTER_TICKET_STATUS"
  | "MASTER_RECONCILED";

/**
 * Appends a system-wide activity log entry. Best-effort: failures are
 * swallowed so audit logging never breaks the primary action.
 */
export async function logActivity(input: {
  userId?: string | null;
  /** Company the action happened in. Pass `user.orgId`. */
  organizationId?: string | null;
  action: ActivityAction;
  module: ActivityModule;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  try {
    // createMany (no RETURNING): lets logs with no company be appended under RLS.
    await rawDb.activityLog.createMany({
      data: [{
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        action: input.action,
        module: input.module,
        entityId: input.entityId ?? null,
        details: input.details
          ? (JSON.parse(JSON.stringify(input.details)) as object)
          : undefined,
        ipAddress: input.ipAddress?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      }],
    });
  } catch {
    // Audit logging must not interrupt the request.
  }
}
