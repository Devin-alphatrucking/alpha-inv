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
  | "MASTER"
  | "SITE"
  | "PURCHASE";

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
  | "INVOICE_COMMENT_ADDED"
  | "INVOICE_COMMENT_DELETED"
  | "PAYMENT_CREATED"
  | "PAYMENT_DELETED"
  | "PAY_RUN_RECORDED"
  | "CATEGORY_CREATED"
  | "VENDOR_CREATED"
  | "VENDOR_DELETED"
  | "VENDOR_MERGED"
  | "COMPANY_CREATED"
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
  | "TWO_STEP_ENABLED"
  | "TWO_STEP_DISABLED"
  | "RECOVERY_CODES_RESET"
  | "RECOVERY_CODE_USED"
  | "MASTER_VIEWED_COMPANY"
  | "MASTER_GRANTED_PLANS"
  | "MASTER_EXTENDED_TRIAL"
  | "MASTER_SET_LIMITS"
  | "MASTER_SET_COMPANY_STATUS"
  | "MASTER_EDITED_PLAN"
  | "MASTER_TICKET_STATUS"
  | "MASTER_RECONCILED"
  | "MASTER_ADDED_NOTE"
  | "MASTER_ADDED_FOLLOWUP"
  | "MASTER_DONE_FOLLOWUP"
  | "MASTER_CREATED_COMPANY"
  | "MASTER_RESET_TWO_STEP"
  | "MASTER_EXPORTED_COMPANY"
  | "MASTER_LOGIN"
  | "MASTER_LOGIN_FAILED"
  | "SITE_REPORT_SAVED"
  | "SITE_REPORT_SUBMITTED"
  | "SITE_REPORT_REOPENED"
  | "SITE_PHOTO_ADDED"
  | "SITE_PHOTO_DELETED"
  | "SITE_ISSUE_RAISED"
  | "SITE_ISSUE_UPDATED"
  | "SITE_ISSUE_STATUS"
  | "REQUEST_SAVED"
  | "REQUEST_SUBMITTED"
  | "REQUEST_WITHDRAWN"
  | "REQUEST_DECIDED"
  | "REQUEST_CANCELLED"
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "ORDER_SENT"
  | "ORDER_CANCELLED"
  | "ORDER_CLOSED"
  | "DOCUMENT_ADDED"
  | "DOCUMENT_REVISION_ADDED"
  | "DOCUMENT_ARCHIVED"
  | "DELIVERY_RECORDED"
  | "DELIVERY_DELETED"
  | "INVOICE_ORDER_LINKED";

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
    // Keep "last active" on the company (our own operators' visits do not count), at most every 5 minutes per company.
    if (input.organizationId && input.module !== "MASTER") {
      const now = new Date();
      await rawDb.organization.updateMany({
        where: { id: input.organizationId, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: new Date(now.getTime() - 5 * 60_000) } }] },
        data: { lastActiveAt: now },
      });
    }
  } catch {
    // Audit logging must not interrupt the request.
  }
}
