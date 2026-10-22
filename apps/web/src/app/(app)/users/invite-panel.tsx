"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, MailPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useFormat } from "@/components/format-provider";
import { inviteUserAction, revokeInviteAction } from "./invite-actions";

type Pending = { id: string; email: string; role: "ADMIN" | "STAFF"; expiresAt: string };

export function InvitePanel({
  projects,
  pending: pendingInvites,
  emailReady,
  limitMessage,
}: {
  projects: { id: string; name: string }[];
  pending: Pending[];
  emailReady: boolean;
  limitMessage?: string | null;
}) {
  const fmt = useFormat();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "STAFF">("STAFF");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await inviteUserAction({ email, role, projectIds });
      if (r.ok) {
        toast.success(r.message);
        setEmail("");
        setProjectIds([]);
      } else setError(r.error);
    });
  }

  function revoke(id: string) {
    start(async () => {
      const r = await revokeInviteAction(id);
      if (r.ok) toast.success("Invitation cancelled");
      else toast.error(r.error);
    });
  }

  if (!emailReady) {
    return <p className="text-sm text-muted-foreground">Invitations by email need email to be set up on this server (SMTP settings). Until then, create users directly below.</p>;
  }

  return (
    <div className="grid gap-5">
      <form onSubmit={send} className="grid gap-4 sm:max-w-xl" noValidate>
        <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
          <div className="grid gap-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inv-role">Role</Label>
            <select
              id="inv-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "STAFF")}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
        </div>

        {role === "STAFF" && projects.length > 0 && (
          <div className="grid gap-2">
            <Label>Projects they can use</Label>
            <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border p-3">
              {projects.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={projectIds.includes(p.id)}
                    onCheckedChange={(v) => setProjectIds((prev) => (v === true ? [...new Set([...prev, p.id])] : prev.filter((x) => x !== p.id)))}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {limitMessage && <p className="text-sm text-amber-700">{limitMessage}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button type="submit" disabled={busy || !email.trim() || Boolean(limitMessage)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
            Send invitation
          </Button>
        </div>
      </form>

      {pendingInvites.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Waiting to be accepted ({pendingInvites.length})</p>
          {pendingInvites.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{i.email}</p>
                <p className="text-xs text-muted-foreground">
                  {i.role.toLowerCase()} · expires {fmt.date(i.expiresAt)}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => revoke(i.id)} aria-label={`Cancel invitation for ${i.email}`}>
                <X className="size-4" />
                Cancel
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
