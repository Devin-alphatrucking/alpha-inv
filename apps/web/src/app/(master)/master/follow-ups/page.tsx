import Link from "next/link";
import { openFollowUps, recentlyDoneFollowUps } from "@/lib/master/queries";
import { dueTone, todayUtc } from "@/lib/master/health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DoneButton } from "../care-client";
import { DueBadge, PageTitle, fmtDate } from "../master-ui";

export const metadata = { title: "Follow-ups | Master console" };
export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const [open, done] = await Promise.all([openFollowUps(), recentlyDoneFollowUps()]);
  const today = todayUtc();
  const overdue = open.filter((f) => dueTone(f.dueOn, today) === "overdue").length;

  return (
    <>
      <PageTitle title="Follow-ups">What our team planned to do next for each company. Add one from the company page.</PageTitle>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">To do ({open.length})</CardTitle>
          <CardDescription>{overdue > 0 ? `${overdue} overdue.` : "Soonest first."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {open.length === 0 && <p className="text-muted-foreground">Nothing planned. Open a company and add a follow-up.</p>}
          {open.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{f.task}</p>
                <p className="text-xs text-muted-foreground">
                  <Link href={`/master/companies/${f.organization.id}`} className="underline-offset-4 hover:underline">{f.organization.name}</Link> · {fmtDate(f.dueOn)} · added by {f.createdByEmail}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <DueBadge tone={dueTone(f.dueOn, today)} />
                <DoneButton id={f.id} done={false} />
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Done recently</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {done.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-muted-foreground line-through">{f.task}</p>
                  <p className="text-xs text-muted-foreground">
                    <Link href={`/master/companies/${f.organization.id}`} className="underline-offset-4 hover:underline">{f.organization.name}</Link> · done {fmtDate(f.doneAt)} by {f.doneByEmail}
                  </p>
                </div>
                <DoneButton id={f.id} done />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
