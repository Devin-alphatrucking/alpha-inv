import type { PlanState } from "@/lib/plans/rules";

// Where each company is on the way from "signed up" to "paying", and what needs our team's attention. Pure rules, no database.

export type Stage = "signed_up" | "set_up" | "using" | "paying" | "lost";
export type Level = "ok" | "watch" | "risk";
export type Reason = { text: string; severity: "low" | "medium" | "high" };

export const STAGES: Stage[] = ["signed_up", "set_up", "using", "paying", "lost"];
export const STAGE_LABEL: Record<Stage, { label: string; hint: string }> = {
  signed_up: { label: "Signed up", hint: "No project yet" },
  set_up: { label: "Set up", hint: "Has a project, not active lately" },
  using: { label: "Using it", hint: "Active in the last 7 days" },
  paying: { label: "Paying", hint: "On a paid plan" },
  lost: { label: "Lost", hint: "Cancelled or trial ended" },
};

export type Signals = {
  state: PlanState;
  createdAt: Date;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  projects: number;
  members: number;
  lastActiveAt: Date | null;
  openTickets: number;
  suspended: boolean;
  now: Date;
};

const DAY = 86_400_000;
export const ACTIVE_DAYS = 7;
export const QUIET_PAYING_DAYS = 14;
export const NEW_GRACE_DAYS = 3;
export const TRIAL_WARNING_DAYS = 3;

const wholeDays = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);
const PAYING: PlanState[] = ["active", "past_due_grace", "past_due", "canceling"];

export function stageOf(s: Signals): Stage {
  if (PAYING.includes(s.state)) return "paying";
  if (s.state === "canceled" || s.state === "trial_expired") return "lost";
  if (s.projects === 0) return "signed_up";
  if (s.lastActiveAt && wholeDays(s.lastActiveAt, s.now) < ACTIVE_DAYS) return "using";
  return "set_up";
}

/** Whole days left in the trial (0 on the last day); null when there is no trial running. */
export function trialDaysLeft(s: Pick<Signals, "state" | "trialEndsAt" | "now">): number | null {
  if (s.state !== "trial" || !s.trialEndsAt) return null;
  return Math.max(0, Math.ceil((s.trialEndsAt.getTime() - s.now.getTime()) / DAY));
}

export function healthOf(s: Signals): { stage: Stage; level: Level; reasons: Reason[] } {
  const stage = stageOf(s);
  const reasons: Reason[] = [];
  const age = wholeDays(s.createdAt, s.now);
  const quietDays = s.lastActiveAt ? wholeDays(s.lastActiveAt, s.now) : null;

  if (s.state === "past_due" || s.state === "past_due_grace") reasons.push({ text: s.state === "past_due" ? "Payment overdue past the grace period" : "Payment overdue (in grace period)", severity: "high" });
  if (s.state === "trial_expired") reasons.push({ text: "Trial ended without a plan", severity: "high" });
  if (s.state === "canceling") reasons.push({ text: "Plan ends at the close of the period", severity: "medium" });

  const left = trialDaysLeft(s);
  if (left !== null && left <= TRIAL_WARNING_DAYS) reasons.push({ text: left === 0 ? "Trial ends today" : `Trial ends in ${left} day${left === 1 ? "" : "s"}`, severity: "high" });

  if (s.state === "trial" || s.state === "none") {
    if (s.projects === 0 && age >= NEW_GRACE_DAYS) reasons.push({ text: `No project after ${age} days`, severity: "medium" });
    else if (s.projects > 0 && age >= NEW_GRACE_DAYS && (quietDays === null || quietDays >= ACTIVE_DAYS)) reasons.push({ text: quietDays === null ? "Set up but never used" : `No activity for ${quietDays} days`, severity: "medium" });
  } else if (stage === "paying" && quietDays !== null && quietDays >= QUIET_PAYING_DAYS) {
    reasons.push({ text: `Paying but no activity for ${quietDays} days`, severity: "medium" });
  }

  if (s.openTickets > 0) reasons.push({ text: `${s.openTickets} open support ${s.openTickets === 1 ? "ticket" : "tickets"}`, severity: "low" });
  if (s.suspended) reasons.push({ text: "Suspended by an operator", severity: "medium" });

  const level: Level = reasons.some((r) => r.severity === "high") ? "risk" : reasons.length ? "watch" : "ok";
  return { stage, level, reasons };
}

// ---- Follow-ups

export type DueTone = "overdue" | "today" | "soon" | "later";

/** `dueOn` and `today` are both calendar dates at midnight UTC. */
export function dueTone(dueOn: Date, today: Date): DueTone {
  const d = Math.round((dueOn.getTime() - today.getTime()) / DAY);
  return d < 0 ? "overdue" : d === 0 ? "today" : d <= 3 ? "soon" : "later";
}

export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A date typed as YYYY-MM-DD, from today up to a year ahead; returns the date or the reason it is not acceptable. */
export function parseDueDate(raw: unknown, today: Date): { ok: true; date: Date } | { ok: false; error: string } {
  const m = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim()) : null;
  if (!m) return { ok: false, error: "Choose a date." };
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCFullYear() !== Number(m[1]) || date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) return { ok: false, error: "That date does not exist." };
  if (date < today) return { ok: false, error: "The date cannot be in the past." };
  if (date.getTime() - today.getTime() > 366 * DAY) return { ok: false, error: "Choose a date within the next year." };
  return { ok: true, date };
}

export function cleanText(raw: unknown, max: number): string | null {
  const t = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  return t.length === 0 || t.length > max ? null : t;
}

// ---- Trends

/** How many of `dates` fall in each of the last `weeks` weeks (oldest first); a week runs Monday to Sunday, in UTC, and the last one is the current week. */
export function weeklyCounts(dates: Date[], now: Date, weeks = 12): { weekStart: Date; count: number }[] {
  const today = todayUtc(now);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY);
  const buckets = Array.from({ length: weeks }, (_, i) => ({ weekStart: new Date(monday.getTime() - (weeks - 1 - i) * 7 * DAY), count: 0 }));
  for (const d of dates) {
    const at = Math.floor((d.getTime() - buckets[0].weekStart.getTime()) / (7 * DAY));
    if (at >= 0 && at < weeks) buckets[at].count++;
  }
  return buckets;
}
