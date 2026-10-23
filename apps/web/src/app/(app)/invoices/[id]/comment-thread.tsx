"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_MAX } from "@/lib/invoices/comment-rules";
import { addCommentAction, deleteCommentAction } from "./comment-actions";

export type ThreadComment = { id: string; body: string; when: string; authorName: string; mine: boolean; canDelete: boolean };

/** The conversation on one invoice: what was said, who said it and when, and a box to add to it. */
export function CommentThread({ invoiceId, comments }: { invoiceId: string; comments: ThreadComment[] }) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  function post() {
    if (!text.trim() || pending) return;
    startTransition(async () => {
      const result = await addCommentAction(invoiceId, text);
      if (result.ok) {
        setText("");
        toast.success("Comment added");
      } else {
        toast.error(result.error);
        box.current?.focus();
      }
    });
  }

  async function remove(id: string) {
    setRemoving(id);
    const result = await deleteCommentAction(invoiceId, id);
    setRemoving(null);
    if (result.ok) toast.success("Comment removed");
    else toast.error(result.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageSquare className="size-4" aria-hidden /> No comments yet. Use this for things like &ldquo;query raised with the vendor&rdquo;.
        </p>
      ) : (
        <ul className="grid gap-3" aria-label="Comments">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border bg-muted/30 px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm">
                  <span className="font-medium">{c.mine ? "You" : c.authorName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.when}</span>
                </p>
                {c.canDelete && (
                  <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" disabled={removing === c.id} onClick={() => void remove(c.id)} aria-label="Remove this comment">
                    {removing === c.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                  </Button>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2">
        <Textarea
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              post();
            }
          }}
          placeholder="Add a comment…"
          rows={3}
          maxLength={COMMENT_MAX + 200}
          aria-label="New comment"
          disabled={pending}
        />
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${text.length > COMMENT_MAX ? "text-destructive" : "text-muted-foreground"}`}>
            {text.length > COMMENT_MAX * 0.8 ? `${text.length} / ${COMMENT_MAX}` : "Everyone who can see this invoice can read it."}
          </span>
          <Button type="button" size="sm" onClick={post} disabled={pending || !text.trim() || text.length > COMMENT_MAX}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageSquare className="size-4" aria-hidden />}
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
