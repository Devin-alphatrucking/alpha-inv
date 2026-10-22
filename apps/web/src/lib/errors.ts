import { rawDb } from "@/lib/db";

export const ERROR_CODES = {
  AUTH_001: { status: 401, message: "Authentication required." },
  PERMISSION_001: {
    status: 403,
    message: "You do not have permission to perform this action.",
  },
  NOT_FOUND_001: { status: 404, message: "Resource not found." },
  VALIDATION_001: { status: 400, message: "Invalid input." },
  INVOICE_001: { status: 400, message: "Invoice operation failed." },
  PAYMENT_001: { status: 400, message: "Payment operation failed." },
  PROJECT_001: { status: 400, message: "Project operation failed." },
  PLAN_001: { status: 403, message: "Your plan does not allow this." },
  QUOTA_001: { status: 429, message: "Monthly AI page limit reached." },
  CONFIG_001: { status: 400, message: "Project configuration is incomplete." },
  DATABASE_001: { status: 500, message: "Database error." },
  INTERNAL_001: { status: 500, message: "Internal server error." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Typed application error carrying an internal code + HTTP status.
 * Never leaks stack traces to clients — only `message` is surfaced.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_CODES[code].message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function safeMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeStack(error: unknown) {
  if (error instanceof Error && error.stack) return error.stack;
  return undefined;
}

let requestIdCounter = 0;

/** Generates a short unique request id (not guaranteed globally unique, but
 *  sufficient for correlation within a log stream). */
export function newRequestId() {
  requestIdCounter = (requestIdCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${requestIdCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export type LogApiErrorInput = {
  statusCode: number;
  errorCode: string;
  endpoint: string;
  method: string;
  userId?: string | null;
  organizationId?: string | null;
  message: string;
  requestId: string;
  error?: unknown;
};

/**
 * Persists a normalized API error record. Used by route handlers and by the
 * centralized server-action boundary. Always swallows its own failures so the
 * original request flow is never interrupted by logging.
 */
export async function logApiError(input: LogApiErrorInput) {
  try {
    // createMany (no RETURNING): lets logs with no company be appended under RLS.
    await rawDb.apiErrorLog.createMany({
      data: [{
        organizationId: input.organizationId ?? null,
        statusCode: input.statusCode,
        errorCode: input.errorCode,
        endpoint: input.endpoint.slice(0, 255),
        method: input.method.slice(0, 16),
        userId: input.userId ?? null,
        message: input.message.slice(0, 2000),
        requestId: input.requestId.slice(0, 64),
        stack: safeStack(input.error)?.slice(0, 8000) ?? null,
      }],
    });
  } catch {
    // Logging must never break the request path.
  }
}

/**
 * Maps an unknown error into an AppError (keeping original AppError codes),
 * logging it to the ApiErrorLog table with full context.
 */
export async function handleError(params: {
  error: unknown;
  endpoint: string;
  method: string;
  userId?: string | null;
  organizationId?: string | null;
  requestId: string;
}): Promise<AppError> {
  const { error } = params;
  const appError = isAppError(error)
    ? error
    : new AppError("INTERNAL_001", safeMessage(error));

  await logApiError({
    statusCode: appError.status,
    errorCode: appError.code,
    endpoint: params.endpoint,
    method: params.method,
    userId: params.userId,
    organizationId: params.organizationId,
    message: appError.message,
    requestId: params.requestId,
    error,
  });

  return appError;
}
