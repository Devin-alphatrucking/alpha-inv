import { toMinor } from "@/lib/invoices/status";

// Project budgets: a project can have a spending limit. Spend = the total of its CONFIRMED invoices (drafts waiting for review do not count yet).
// Pure functions, unit-tested (budget.test.ts). Amounts are compared in whole paise/cents.

export type BudgetLevel = "none" | "ok" | "warn" | "over";

/** Alert at 80% and again at 100%. */
export const WARN_AT = 0.8;

export type BudgetStatus = {
  level: BudgetLevel;
  /** Percent of the budget used (can be above 100). null when there is no budget. */
  percent: number | null;
  spentMinor: number;
  budgetMinor: number | null;
  /** What is left (never negative); null when there is no budget. */
  remainingMinor: number | null;
  /** How far over, 0 when not over. */
  overMinor: number;
};

export function budgetStatus(spent: number, budget: number | null | undefined): BudgetStatus {
  const spentMinor = Math.max(0, toMinor(spent));
  if (budget === null || budget === undefined || !Number.isFinite(budget) || budget <= 0) {
    return { level: "none", percent: null, spentMinor, budgetMinor: null, remainingMinor: null, overMinor: 0 };
  }
  const budgetMinor = toMinor(budget);
  const ratio = spentMinor / budgetMinor;
  const level: BudgetLevel = ratio >= 1 ? "over" : ratio >= WARN_AT ? "warn" : "ok";
  return {
    level,
    percent: Math.round(ratio * 1000) / 10,
    spentMinor,
    budgetMinor,
    remainingMinor: Math.max(0, budgetMinor - spentMinor),
    overMinor: Math.max(0, spentMinor - budgetMinor),
  };
}

export type BudgetAlert = { projectId: string; name: string; level: "warn" | "over"; percent: number; spentMinor: number; budgetMinor: number };

/** Projects at 80% or more of their budget, the ones over first, then by how far along they are. */
export function budgetAlerts(projects: { id: string; name: string; spent: number; budget: number | null | undefined }[]): BudgetAlert[] {
  const out: BudgetAlert[] = [];
  for (const p of projects) {
    const s = budgetStatus(p.spent, p.budget);
    if ((s.level === "warn" || s.level === "over") && s.percent !== null && s.budgetMinor !== null) {
      out.push({ projectId: p.id, name: p.name, level: s.level, percent: s.percent, spentMinor: s.spentMinor, budgetMinor: s.budgetMinor });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? b.percent - a.percent : a.level === "over" ? -1 : 1));
}

/** The budget box on a form: blank means "no budget"; otherwise a positive amount with at most 2 decimals. */
export function parseBudgetInput(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const text = String(raw).trim().replace(/,/g, "");
  if (text === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter the budget as a number, for example 2500000 or 2500000.50." };
  const n = Number(text);
  if (n <= 0) return { ok: true, value: null }; // 0 means "no budget"
  if (n > 99_999_999_999) return { ok: false, error: "That budget is too large." };
  return { ok: true, value: n };
}
