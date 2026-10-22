import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { peekToken } from "@/lib/security/tokens";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password" };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams;
  const valid = token ? Boolean(await peekToken(token, "PASSWORD_RESET")) : false;

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={valid ? "Pick something you have not used elsewhere." : undefined}
      footer={
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Back to sign in
        </Link>
      }
    >
      {valid ? (
        <ResetForm token={token!} />
      ) : (
        <div className="grid gap-3 text-center">
          <p className="text-sm text-muted-foreground">This reset link is invalid or has expired.</p>
          <Link href="/forgot-password" className="text-sm font-medium underline underline-offset-2">
            Request a new link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
