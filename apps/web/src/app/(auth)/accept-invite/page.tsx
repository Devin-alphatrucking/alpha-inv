import Link from "next/link";
import { AuthShell, legalLinks } from "@/components/auth-shell";
import { auth } from "@/lib/auth";
import { describeInvite } from "@/lib/flows/invite";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Accept your invitation" };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function AcceptInvitePage({ searchParams }: Props) {
  const { token } = await searchParams;
  const invite = await describeInvite(token);

  if (!invite || !token) {
    return (
      <AuthShell title="Invitation not available">
        <div className="grid gap-3 text-center">
          <p className="text-sm text-muted-foreground">This invitation is invalid, has expired or was cancelled. Ask the person who invited you to send a new one.</p>
          <Link href="/login" className="text-sm font-medium underline underline-offset-2">
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  const session = await auth();
  const signedInAsInvitee = Boolean(session?.user?.id && session.user.id === invite.existingUserId);
  const links = legalLinks();

  return (
    <AuthShell
      title={`Join ${invite.company}`}
      subtitle={`${invite.inviterName} invited you as ${invite.role.toLowerCase()} (${invite.email}).`}
    >
      <AcceptInviteForm
        token={token}
        invite={{ email: invite.email, company: invite.company, slug: invite.slug, hasAccount: invite.hasAccount }}
        signedInAsInvitee={signedInAsInvitee}
        signedInOther={Boolean(session?.user?.id) && !signedInAsInvitee}
        termsUrl={links.terms}
        privacyUrl={links.privacy}
      />
    </AuthShell>
  );
}
