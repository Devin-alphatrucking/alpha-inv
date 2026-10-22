import { Text, View } from "react-native";
import type { PlanSummary } from "@/lib/client";
import { space, useTheme } from "@/lib/theme";

/** A strip at the top when the company's plan needs attention. Nothing is shown for a healthy plan. No buying here (store rules): buying is on the website. */
export function PlanBanner({ plan }: { plan: PlanSummary }) {
  const t = useTheme();
  let text: string | null = null;
  let tone: "warn" | "danger" = "warn";
  if (plan.state === "trial" && plan.trialDaysLeft !== null) text = `Free trial: ${plan.trialDaysLeft} day${plan.trialDaysLeft === 1 ? "" : "s"} left.`;
  else if (plan.state === "past_due_grace") text = "A payment is overdue. Please settle it on the website to keep adding invoices.";
  else if (plan.message) {
    text = plan.message;
    tone = "danger";
  }
  if (!text) return null;
  const color = tone === "danger" ? t.danger : t.warn;
  return (
    <View accessibilityRole="alert" style={{ marginHorizontal: space.lg, marginBottom: space.md, borderRadius: 12, borderWidth: 1, borderColor: color, padding: space.md, backgroundColor: t.card }}>
      <Text style={{ color, fontSize: 13, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}
