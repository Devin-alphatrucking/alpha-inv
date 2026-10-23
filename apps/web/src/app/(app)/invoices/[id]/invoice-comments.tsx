import type { SessionUser } from "@/lib/invoices/access";
import { getFormat } from "@/lib/brand/brand";
import { listComments } from "@/lib/flows/comments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CommentThread } from "./comment-thread";

/** The comments card for an invoice page. Shows nothing for an invoice this person cannot see. */
export async function InvoiceComments({ invoiceId, user }: { invoiceId: string; user: SessionUser }) {
  const fmt = await getFormat();
  const rows = await listComments(user, invoiceId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Comments ({rows.length})</CardTitle>
        <CardDescription>Notes for your team about this invoice, oldest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <CommentThread
          invoiceId={invoiceId}
          comments={rows.map((c) => ({ id: c.id, body: c.body, when: fmt.dateTime(c.createdAt), authorName: c.authorName, mine: c.mine, canDelete: c.canDelete }))}
        />
      </CardContent>
    </Card>
  );
}
