import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getBrand } from "@/lib/brand/brand";
import { getBillingSummary } from "@/lib/billing/service";
import { formatMoney } from "@/lib/billing/rules";
import { companyLock, lockedMessage } from "@/lib/plans/lock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BuyButton } from "../plan/billing-controls";

export const metadata = { title: "Choose a plan" };
export const dynamic = "force-dynamic";

/** Where every page sends a person whose company is locked (trial over, plan ended or unpaid). Nothing of the company's data is shown here. */
export default async function LockedPage() {
  const { session, orgId } = await pageOrg({ allowLocked: true });
  const lock = await companyLock(orgId);
  if (!lock.locked) redirect("/dashboard");

  const isAdmin = session.user.role === "ADMIN";
  const [brand, billing] = await Promise.all([getBrand(), getBillingSummary(orgId)]);
  const price = billing.plan?.priceMinor ? formatMoney(billing.plan.priceMinor, billing.plan.currency) : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <Lock className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Your data is locked</h1>
        <p className="max-w-md text-sm text-muted-foreground">{lockedMessage(lock.state)}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isAdmin ? "Choose a plan to unlock everything" : "Ask your administrator"}</CardTitle>
          <CardDescription>
            {isAdmin
              ? `One project plan includes 1 project, its own people and AI pages${price ? ` and costs ${price} per ${billing.plan?.interval === "YEAR" ? "year" : "month"}` : ""}. Everything you entered comes back the moment the plan is active.`
              : "Only an administrator of your company can choose a plan. Everything you and your team entered is kept and comes back as soon as a plan is active."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {isAdmin && billing.purchasable && <BuyButton priceLabel={price ?? ""} brandName={brand.name} />}
          {isAdmin && !billing.purchasable && (
            <p className="text-sm text-muted-foreground">Online payment is not switched on yet. Contact support and we will set your plan up.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button variant="outline" nativeButton={false} render={<Link href="/plan" />}>
                Plan &amp; billing
              </Button>
            )}
            <Button variant="outline" nativeButton={false} render={<Link href="/support" />}>
              Contact support
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/account" />}>
              My account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
