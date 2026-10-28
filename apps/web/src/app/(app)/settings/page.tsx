import { notFound } from "next/navigation";
import { pageOrg } from "@/lib/org/page";
import { HubLinks } from "@/components/hub-links";
import { SETTINGS_LINKS, hubLinksFor } from "@/lib/nav";

export const metadata = { title: "Settings" };

/** Everything that is set up once and rarely changed: people, projects, categories, the company, the plan, logs and help. */
export default async function SettingsPage() {
  const { session } = await pageOrg({ allowLocked: true });
  const links = hubLinksFor(SETTINGS_LINKS, session.user.role);
  if (links.length === 0) notFound();
  return <HubLinks title="Settings" intro="People, projects, your company and your plan." links={links} />;
}
