import { redirect } from "next/navigation";
import { homeFor } from "@/lib/roles";
import { pageOrg } from "@/lib/org/page";
import { ADDONS, enabledAddons } from "@/lib/addons";
import { AddonsPanel } from "./addons-panel";

export const metadata = { title: "Add-on modules" };

export default async function AddOnsPage() {
  const { session, orgId } = await pageOrg();
  if (session.user.role !== "ADMIN") redirect(homeFor(session.user.role));
  const on = new Set(await enabledAddons(orgId));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add-on modules</h1>
        <p className="text-sm text-muted-foreground">
          Optional modules you can use or ignore. Each one stands on its own: it keeps its own records and does not touch your invoices, payments, purchase or site work.
        </p>
      </div>
      <AddonsPanel items={ADDONS.map((a) => ({ key: a.key, name: a.name, description: a.description, href: a.href, on: on.has(a.key) }))} />
    </div>
  );
}
