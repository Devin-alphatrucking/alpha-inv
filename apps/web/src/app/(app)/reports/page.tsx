import { notFound } from "next/navigation";
import { pageOrg } from "@/lib/org/page";
import { HubLinks } from "@/components/hub-links";
import { REPORT_LINKS, hubLinksFor } from "@/lib/nav";

export const metadata = { title: "Reports & tools" };

export default async function ReportsPage() {
  const { session } = await pageOrg();
  const links = hubLinksFor(REPORT_LINKS, session.user.role);
  if (links.length === 0) notFound();
  return <HubLinks title="Reports & tools" intro="Reports, the payment planner and the rate sheet." links={links} />;
}
