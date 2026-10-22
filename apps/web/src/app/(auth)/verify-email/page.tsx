import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { peekToken } from "@/lib/security/tokens";
import { VerifyEmailPanel } from "./verify-panel";

export const metadata = { title: "Confirm your email" };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { token } = await searchParams;
  // Looking at the link does NOT use it up: a person has to press the button. That keeps
  // email scanners (which open every link) from consuming it.
  const valid = token ? Boolean(await peekToken(token, "EMAIL_VERIFY")) : false;

  return (
    <AuthShell
      title="Confirm your email"
      subtitle={valid ? "One more step to finish setting up your account." : undefined}
      footer={
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Back to sign in
        </Link>
      }
    >
      <VerifyEmailPanel token={valid ? token! : null} linkProblem={Boolean(token) && !valid} />
    </AuthShell>
  );
}
