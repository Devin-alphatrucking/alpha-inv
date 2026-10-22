import { NextResponse } from "next/server";
import { AppError, handleError, isAppError, newRequestId } from "@/lib/errors";
import { authenticateBearer, type MobileUser } from "./sessions";
import { bearerFrom } from "./token";

/** Shared plumbing for /api/v1: JSON in and out, one error shape, no caching. */

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const apiError = (status: number, code: string, error: string) => json({ error, code }, status);

const MAX_BODY = 64 * 1024;

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new AppError("VALIDATION_001", "Request is too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_001", "Request body must be JSON.");
  }
}

/** The signed-in person for this request (bearer token), including the session id. */
export async function requireMobile(req: Request): Promise<MobileUser> {
  const token = bearerFrom(req.headers.get("authorization"));
  const user = token ? await authenticateBearer(token) : null;
  if (!user) throw new AppError("AUTH_001", "Please sign in again.");
  return user;
}

/** Wraps a handler so every failure leaves as the same JSON error and is logged with a request id. */
export function route<C = unknown>(endpoint: string, fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const requestId = newRequestId();
    try {
      return await fn(req, ctx);
    } catch (error) {
      if (isAppError(error) && error.code === "AUTH_001") return apiError(401, "unauthenticated", error.message);
      const appError = await handleError({ error, endpoint, method: req.method, requestId });
      const status = isAppError(error) ? appError.status : 500;
      return json({ error: appError.message, code: appError.code, requestId }, status);
    }
  };
}
