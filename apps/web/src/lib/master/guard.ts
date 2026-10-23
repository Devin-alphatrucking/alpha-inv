import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type PlatformAdmin = { id: string; email: string; name: string; twoStep: boolean };

/**
 * The person must be signed in AND flagged as a platform operator in the database RIGHT NOW (never from the session
 * token, so removing the flag takes effect at once), with a verified, undeleted account.
 * Returns null otherwise.
 */
export async function currentPlatformAdmin(): Promise<PlatformAdmin | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const u = await rawDb.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, isPlatformAdmin: true, deletedAt: true, emailVerifiedAt: true, totpEnabledAt: true } });
  if (!u || !u.isPlatformAdmin || u.deletedAt || !u.emailVerifiedAt) return null;
  return { id: u.id, email: u.email, name: u.name, twoStep: u.totpEnabledAt !== null };
}

/** For server actions: throws 403 for anyone who is not a platform operator. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await currentPlatformAdmin();
  if (!admin) throw new AppError("PERMISSION_001");
  // The console changes plans, prices and company access for everyone: it needs two-step sign-in, not just a password.
  if (!admin.twoStep) throw new AppError("PERMISSION_001", "Turn on two-step sign-in on your Account page to use the master console.");
  return admin;
}

/** For pages and layouts: shows a plain 404 to everyone else, so the console's existence is not revealed. */
export async function pagePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await currentPlatformAdmin();
  if (!admin) notFound();
  return admin;
}
