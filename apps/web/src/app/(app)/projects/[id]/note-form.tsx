"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addProjectNote } from "../actions";

export function ProjectNoteForm({ projectId }: { projectId: string }) {
  const [content, setContent] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!content.trim()) return;
    startTransition(async () => {
      try {
        await addProjectNote({ projectId, content });
        setContent("");
        toast.success("Note added");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add note");
      }
    });
  }

  return (
    <div className="flex gap-2">
      <Input
        value={content}
        placeholder="Add a note…"
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button
        type="button"
        size="icon"
        aria-label="Add note"
        disabled={pending || !content.trim()}
        onClick={submit}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      </Button>
    </div>
  );
}
