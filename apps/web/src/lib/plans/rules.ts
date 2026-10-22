// Plan rules (Phase 4). Pure functions only: no database, no imports, so every rule is unit-tested.
// Model: ONE plan = ONE project. A company buys the plan `quantity` times; each copy adds the plan's
// projects, users and AI pages. See docs/PHASE-4-PLANS-AND-SUPPORT.md.

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";

export type PlanInput = {
  code: string;
  name: string;
  includedProjects: number;
  userLimit: number;
  aiPagesPerProject: number;
};

export type SubscriptionInput = {
  status: SubscriptionStatus;
  quantity: number;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd?: boolean;
  overrides?: unknown;
};

/**
 *  trial          free trial running
 *  trial_expired  trial over and nothing was bought
 *  active         paid (or set up by an operator)
 *  past_due_grace payment failed, still inside the grace period (everything keeps working)
 *  past_due       payment failed and the grace period is over
 *  canceling      cancelled, but the paid period has not ended yet
 *  canceled       cancelled and the paid period is over
 *  none           the company has no subscription at all
 */
export type PlanState = "trial" | "trial_expired" | "active" | "past_due_grace" | "past_due" | "canceling" | "canceled" | "none";

/** States in which people may still ADD things (upload invoices, add projects and users). Viewing and editing existing data is never blocked. */
const GROWTH_ALLOWED: ReadonlySet<PlanState> = new Set(["trial", "active", "past_due_grace", "canceling"]);

export function planState(sub: SubscriptionInput | null, now: Date = new Date()): PlanState {
  if (!sub) return "none";
  switch (sub.status) {
    case "ACTIVE":
      return "active";
    case "TRIALING":
      return sub.trialEndsAt && sub.trialEndsAt > now ? "trial" : "trial_expired";
    case "PAST_DUE":
      return sub.graceEndsAt && sub.graceEndsAt > now ? "past_due_grace" : "past_due";
    case "CANCELED":
      return sub.currentPeriodEnd && sub.currentPeriodEnd > now ? "canceling" : "canceled";
  }
}

export function allowsGrowth(state: PlanState) {
  return GROWTH_ALLOWED.has(state);
}

export type Overrides = { extraProjects: number; extraUsers: number; aiPagesPerProject: number | null };

const nonNegInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000 ? Math.floor(v) : 0);

/** Operator overrides, cleaned so a bad value can never grant a negative or absurd limit. */
export function parseOverrides(raw: unknown): Overrides {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pages = typeof o.aiPagesPerProject === "number" && Number.isFinite(o.aiPagesPerProject) && o.aiPagesPerProject >= 0 ? Math.floor(o.aiPagesPerProject) : null;
  return { extraProjects: nonNegInt(o.extraProjects), extraUsers: nonNegInt(o.extraUsers), aiPagesPerProject: pages };
}

export type Limits = {
  /** Active projects the company may have. */
  projects: number;
  /** People (members plus open invitations) the company may have. */
  users: number;
  /** AI pages per project per month. */
  aiPagesPerProject: number;
  /** Largest company-wide monthly AI page cap that makes sense (projects x pages). */
  companyPageCap: number;
};

export function computeLimits(plan: PlanInput, sub: Pick<SubscriptionInput, "quantity" | "overrides">): Limits {
  const quantity = Math.max(0, Math.floor(sub.quantity));
  const o = parseOverrides(sub.overrides);
  const projects = quantity * plan.includedProjects + o.extraProjects;
  const users = quantity * plan.userLimit + o.extraUsers;
  const aiPagesPerProject = o.aiPagesPerProject ?? plan.aiPagesPerProject;
  return { projects, users, aiPagesPerProject, companyPageCap: projects * aiPagesPerProject };
}

export type Usage = { projects: number; users: number; pendingInvites: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function blockedMessage(state: PlanState): string {
  switch (state) {
    case "trial_expired":
      return "Your free trial has ended. Choose a plan to keep adding projects, people and invoices. Existing data stays available. Contact support to continue.";
    case "past_due":
      return "Your last payment did not go through and the grace period has ended. Adding projects, people and invoices is paused until it is settled. Existing data stays available.";
    case "canceled":
      return "This subscription has ended. Adding projects, people and invoices is paused. Existing data stays available. Contact support to restart.";
    case "none":
      return "This company does not have a plan yet. Contact support to set one up.";
    default:
      return "";
  }
}

export type Check = { ok: true } | { ok: false; message: string };

export function checkAddProject(state: PlanState, limits: Limits, usage: Usage): Check {
  if (!allowsGrowth(state)) return { ok: false, message: blockedMessage(state) };
  if (usage.projects + 1 > limits.projects) {
    return {
      ok: false,
      message: `Your plan includes ${plural(limits.projects, "project")} and you already have ${usage.projects}. To add another project, add another project plan (contact support), or mark a finished project as completed or archived.`,
    };
  }
  return { ok: true };
}

/** `adding` people are about to be added. Open invitations count, so two invitations cannot share one free seat. */
export function checkAddUsers(state: PlanState, limits: Limits, usage: Usage, adding = 1): Check {
  if (!allowsGrowth(state)) return { ok: false, message: blockedMessage(state) };
  const after = usage.users + usage.pendingInvites + adding;
  if (after > limits.users) {
    const taken = usage.users + usage.pendingInvites;
    return {
      ok: false,
      message: `Your plan includes ${plural(limits.users, "user")} and ${taken} ${taken === 1 ? "is" : "are"} already taken (including open invitations). Remove someone, cancel an invitation, or add another project plan (it adds more users).`,
    };
  }
  return { ok: true };
}

export function checkAddInvoices(state: PlanState): Check {
  return allowsGrowth(state) ? { ok: true } : { ok: false, message: blockedMessage(state) };
}

/** A company admin may LOWER the AI page limit of a project, never raise it above what the plan includes. */
export function checkPageLimit(requested: number, limits: Limits): Check {
  if (requested > limits.aiPagesPerProject) {
    return { ok: false, message: `Your plan includes up to ${limits.aiPagesPerProject} AI pages per project per month.` };
  }
  return { ok: true };
}

export function checkCompanyPageCap(requested: number, limits: Limits): Check {
  if (requested > limits.companyPageCap) {
    return { ok: false, message: `Your plan covers up to ${limits.companyPageCap} AI pages per month across all projects.` };
  }
  return { ok: true };
}

export function trialDaysLeft(sub: Pick<SubscriptionInput, "trialEndsAt"> | null, now: Date = new Date()): number | null {
  if (!sub?.trialEndsAt) return null;
  const ms = sub.trialEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** Support priority shown on tickets: paid plans first. */
export function ticketPriority(state: PlanState): "NORMAL" | "HIGH" {
  return state === "active" || state === "past_due_grace" || state === "canceling" ? "HIGH" : "NORMAL";
}
