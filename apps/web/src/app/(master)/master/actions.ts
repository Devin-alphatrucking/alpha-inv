"use server";

import { revalidatePath } from "next/cache";
import { isAppError } from "@/lib/errors";
import { requirePlatformAdmin } from "@/lib/master/guard";
import { editPlan, extendTrial, reconcileNow, setCompanyStatus, setLimits, setProjectPlans, setTicketStatus } from "@/lib/master/ops";

// Every action re-checks, in the database, that the caller is a platform operator. Nothing here trusts the browser.
export type MasterResult = { ok: true; message: string } | { ok: false; error: string };
type Form = Record<string, string>;

const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? NaN : Number(v));
const numOrNull = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v));

async function run(path: string, message: string, fn: () => Promise<unknown>): Promise<MasterResult> {
  try {
    await requirePlatformAdmin();
    await fn();
    revalidatePath(path, "layout");
    return { ok: true, message };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.message };
    console.error("[master action]", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Nothing was changed." };
  }
}

export async function setProjectPlansAction(orgId: string, f: Form) {
  return run("/master", "Project plans updated.", async () => setProjectPlans(await requirePlatformAdmin(), orgId, num(f.count), f.reason));
}

export async function extendTrialAction(orgId: string, f: Form) {
  return run("/master", "Trial extended.", async () => extendTrial(await requirePlatformAdmin(), orgId, num(f.days), f.reason));
}

export async function setLimitsAction(orgId: string, f: Form) {
  return run("/master", "Limits saved.", async () =>
    setLimits(await requirePlatformAdmin(), orgId, { extraProjects: num(f.extraProjects), extraUsers: num(f.extraUsers), aiPagesPerProject: numOrNull(f.aiPages) }, f.reason),
  );
}

export async function setCompanyStatusAction(orgId: string, status: "ACTIVE" | "SUSPENDED", f: Form) {
  return run("/master", status === "SUSPENDED" ? "Company suspended." : "Company reactivated.", async () => setCompanyStatus(await requirePlatformAdmin(), orgId, status, f.reason));
}

export async function editPlanAction(code: string, f: Form) {
  return run("/master", "Plan saved.", async () =>
    editPlan(
      await requirePlatformAdmin(),
      code,
      { name: f.name, priceMinor: numOrNull(f.priceMinor), currency: f.currency, userLimit: num(f.userLimit), aiPagesPerProject: num(f.aiPagesPerProject), includedProjects: num(f.includedProjects) },
      f.reason,
    ),
  );
}

export async function setTicketStatusAction(ticketId: string, status: string) {
  return run("/master/tickets", "Ticket updated.", async () => setTicketStatus(await requirePlatformAdmin(), ticketId, status));
}

export async function reconcileAction(orgId?: string): Promise<MasterResult> {
  try {
    const admin = await requirePlatformAdmin();
    const r = await reconcileNow(admin, orgId);
    revalidatePath("/master", "layout");
    return { ok: true, message: `Checked ${r.checked} purchase${r.checked === 1 ? "" : "s"}, ${r.changed} changed.` };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.message };
    console.error("[master reconcile]", error instanceof Error ? error.message : error);
    return { ok: false, error: "Could not reach the payment service." };
  }
}
