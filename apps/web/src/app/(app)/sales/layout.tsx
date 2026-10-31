import { pageOrg } from "@/lib/org/page";
import { requireAddon } from "@/lib/addons";
import { SalesTabs } from "./sales-tabs";

/** Every Sales page: the add-on must be switched on (otherwise people are sent to the Add-on modules page), with a small tab bar on top. */
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = await pageOrg();
  await requireAddon(orgId, "sales");
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <SalesTabs />
      {children}
    </div>
  );
}
