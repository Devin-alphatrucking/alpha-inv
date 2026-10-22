import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/permissions";
import { assertProjectAccess } from "@/lib/projects/access";
import { PROJECT_SCOPE_COOKIE } from "@/lib/projects/scope";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = (await request.json()) as { projectId?: string | null };
  const projectId = body.projectId?.trim() || null;

  if (!projectId && user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Staff must work within an assigned project." },
      { status: 400 }
    );
  }

  if (projectId) {
    await assertProjectAccess(projectId, user);
  }

  const cookieStore = await cookies();
  if (projectId) {
    cookieStore.set(PROJECT_SCOPE_COOKIE, projectId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    cookieStore.delete(PROJECT_SCOPE_COOKIE);
  }

  return NextResponse.json({ projectId });
}

