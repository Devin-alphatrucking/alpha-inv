"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  changePasswordAction,
  closeCompanyAction,
  deleteAccountAction,
  signOutEverywhereAction,
  switchCompanyAction,
} from "./actions";

type Props = {
  companies: { id: string; name: string; role: string }[];
  currentOrgId: string;
  currentCompanyName: string;
  isAdmin: boolean;
};

export function AccountPanels({ companies, currentOrgId, currentCompanyName, isAdmin }: Props) {
  const [pending, start] = useTransition();

  // ---- change password
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [pwError, setPwError] = useState<{ message: string; field?: string } | null>(null);

  function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (next !== again) return setPwError({ message: "The two new passwords do not match.", field: "newPassword" });
    start(async () => {
      const r = await changePasswordAction(cur, next);
      if (r.ok) {
        toast.success("Password changed. Other devices were signed out.");
        setCur("");
        setNext("");
        setAgain("");
      } else setPwError({ message: r.error, field: r.field });
    });
  }

  // ---- delete account / close company
  const [delPw, setDelPw] = useState("");
  const [delWord, setDelWord] = useState("");
  const [delError, setDelError] = useState<string | null>(null);
  function deleteAccount() {
    setDelError(null);
    start(async () => {
      const r = await deleteAccountAction(delPw);
      if (r && !r.ok) setDelError(r.error);
    });
  }

  const [closePw, setClosePw] = useState("");
  const [closeWord, setCloseWord] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  function closeCompany() {
    setCloseError(null);
    start(async () => {
      const r = await closeCompanyAction(closePw);
      if (r && !r.ok) setCloseError(r.error);
    });
  }

  function switchTo(id: string) {
    start(async () => {
      const r = await switchCompanyAction(id);
      if (r.ok) window.location.assign("/dashboard");
      else toast.error(r.error);
    });
  }

  const pwFieldError = (f: string) => (pwError?.field === f ? <p className="text-xs text-destructive">{pwError.message}</p> : null);

  return (
    <>
      {companies.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your companies</CardTitle>
            <CardDescription>You belong to more than one company. Choose which one to work in.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {companies.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.role.toLowerCase()}</p>
                </div>
                {c.id === currentOrgId ? (
                  <span className="text-xs font-medium text-emerald-600">Current</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => switchTo(c.id)}>
                    Switch
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>You will stay signed in here; every other device is signed out.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="grid max-w-sm gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="ac-cur">Current password</Label>
              <Input id="ac-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
              {pwFieldError("password")}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-new">New password</Label>
              <Input id="ac-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
              <p className="text-xs text-muted-foreground">At least 10 characters.</p>
              {pwFieldError("newPassword")}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-again">Repeat the new password</Label>
              <Input id="ac-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
            </div>
            {pwError && !pwError.field && <p className="text-sm text-destructive">{pwError.message}</p>}
            <div>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions</CardTitle>
          <CardDescription>Lost a phone or used a shared computer? Sign out everywhere, including this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={pending} onClick={() => start(async () => signOutEverywhereAction())}>
            Sign out of all devices
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Delete my account</CardTitle>
          <CardDescription>
            Your name, email and password are erased and you are removed from every company. Invoices and records you created stay, shown as made by &quot;Deleted user&quot;. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-sm gap-3">
          <div className="grid gap-2">
            <Label htmlFor="del-pw">Your password</Label>
            <Input id="del-pw" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="del-word">Type DELETE to confirm</Label>
            <Input id="del-word" value={delWord} onChange={(e) => setDelWord(e.target.value)} />
          </div>
          {delError && <p className="text-sm text-destructive">{delError}</p>}
          <div>
            <Button variant="destructive" disabled={pending || !delPw || delWord !== "DELETE"} onClick={deleteAccount}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete my account
            </Button>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Close {currentCompanyName}</CardTitle>
            <CardDescription>
              Nobody in this company can sign in afterwards and every open invitation is cancelled. Your data is kept so it can be exported or restored on request, until it is deleted under your retention policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid max-w-sm gap-3">
            <div className="grid gap-2">
              <Label htmlFor="close-pw">Your password</Label>
              <Input id="close-pw" type="password" autoComplete="current-password" value={closePw} onChange={(e) => setClosePw(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="close-word">Type CLOSE to confirm</Label>
              <Input id="close-word" value={closeWord} onChange={(e) => setCloseWord(e.target.value)} />
            </div>
            {closeError && <p className="text-sm text-destructive">{closeError}</p>}
            <div>
              <Button variant="destructive" disabled={pending || !closePw || closeWord !== "CLOSE"} onClick={closeCompany}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Close company
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
