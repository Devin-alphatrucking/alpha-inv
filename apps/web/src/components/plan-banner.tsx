import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { blockedMessage } from "@/lib/plans/rules";
import type { Entitlements } from "@/lib/plans/entitlements";

/** A thin strip at the top of the app when the plan needs attention. Nothing is shown for a healthy paid plan. */
export function PlanBanner({ e, isAdmin, format }: { e: Entitlements; isAdmin: boolean; format: (d: Date) => string }) {
  let tone: "info" | "warn" | "danger" | null = null;
  let text = "";

  switch (e.state) {
    case "trial":
      tone = (e.trialDaysLeft ?? 0) <= 3 ? "warn" : "info";
      text = `Free trial: ${e.trialDaysLeft} day${e.trialDaysLeft === 1 ? "" : "s"} left.`;
      break;
    case "past_due_grace":
      tone = "warn";
      text = `Your last payment did not go through. Everything keeps working until ${e.graceEndsAt ? format(e.graceEndsAt) : "the end of the grace period"}.`;
      break;
    case "canceling":
      tone = "info";
      text = `Your subscription ends on ${e.currentPeriodEnd ? format(e.currentPeriodEnd) : "the end of the period"}.`;
      break;
    case "trial_expired":
    case "past_due":
    case "canceled":
    case "none":
      tone = "danger";
      text = blockedMessage(e.state);
      break;
    default:
      return null;
  }
  if (!tone) return null;

  const colors = {
    info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100",
    warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
    danger: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
  }[tone];
  const Icon = tone === "info" ? Clock : AlertTriangle;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm sm:px-6 ${colors}`} role="status">
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <Link href={isAdmin ? "/plan" : "/support"} className="shrink-0 font-medium underline underline-offset-2">
        {isAdmin ? "Plan & usage" : "Contact support"}
      </Link>
    </div>
  );
}
