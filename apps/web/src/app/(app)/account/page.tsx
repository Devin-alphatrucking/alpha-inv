import { rawDb } from "@/lib/db";
import { pageOrg } from "@/lib/org/page";
import { listMyCompanies } from "@/lib/flows/account";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountPanels } from "./account-panels";
import { TwoFactorPanel } from "./two-factor-panel";
import { twoFactorStatus } from "@/lib/flows/two-factor";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const { session, orgId } = await pageOrg();
  const tf = await twoFactorStatus(session.user.id);
  const [user, companies, org] = await Promise.all([
    rawDb.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { name: true, email: true, emailVerifiedAt: true } }),
    listMyCompanies(session.user.id),
    rawDb.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, displayName: true } }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your sign-in details, password and security.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>The details you sign in with.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Name: </span>
            <span className="font-medium">{user.name}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Email: </span>
            <span className="font-medium">{user.email}</span>{" "}
            <span className={user.emailVerifiedAt ? "text-emerald-600" : "text-amber-600"}>({user.emailVerifiedAt ? "confirmed" : "not confirmed"})</span>
          </p>
          <p>
            <span className="text-muted-foreground">Company: </span>
            <span className="font-medium">{org.displayName || org.name}</span> as {session.user.role.toLowerCase()}
          </p>
        </CardContent>
      </Card>

      <TwoFactorPanel enabled={tf.enabled} recoveryLeft={tf.recoveryLeft} isOperator={tf.isOperator} />

      <AccountPanels
        companies={companies}
        currentOrgId={orgId}
        currentCompanyName={org.displayName || org.name}
        isAdmin={session.user.role === "ADMIN"}
      />
    </div>
  );
}
