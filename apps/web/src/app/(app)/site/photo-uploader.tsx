"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PHOTOS_PER_UPLOAD } from "@/lib/site/rules";

const MAX_SIDE = 1800;

/** Shrinks a phone photo (often 4-8 MB) to about 300-600 KB before it is sent. A file that cannot be decoded is sent as it is. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Take or choose photos (on a phone this opens the camera), tag them with where on site, and add them to a project, report or issue. */
export function PhotoUploader({ projectId, reportId, issueId, receiptId, label = "Add photos" }: { projectId: string; reportId?: string; issueId?: string; receiptId?: string; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [area, setArea] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(list: FileList | null) {
    if (!list || list.length === 0) return;
    const chosen = Array.from(list);
    if (chosen.length > PHOTOS_PER_UPLOAD) {
      toast.error(`Add at most ${PHOTOS_PER_UPLOAD} photos at a time.`);
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("projectId", projectId);
      if (reportId) form.set("reportId", reportId);
      if (issueId) form.set("issueId", issueId);
      if (receiptId) form.set("receiptId", receiptId);
      form.set("area", area);
      form.set("caption", caption);
      for (const file of await Promise.all(chosen.map(shrink))) form.append("file", file);
      const res = await fetch("/api/site/photos", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; added?: number; skipped?: string[]; error?: string };
      if (res.ok && data.ok) {
        toast.success(data.added === 1 ? "Photo added" : `${data.added} photos added`);
        if (data.skipped?.length) toast.error(`Not added: ${data.skipped.join("; ")}`);
        setCaption("");
        router.refresh();
      } else {
        toast.error(data.error ?? "The photos could not be added.");
      }
    } catch {
      toast.error("The photos could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={120} placeholder="Where on site (e.g. Tower A, level 3)" aria-label="Where on site" disabled={busy} />
        <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder="Note about the photo (optional)" aria-label="Photo note" disabled={busy} />
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple className="sr-only" aria-label="Choose photos" onChange={(e) => void send(e.target.files)} />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()} className="justify-self-start">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
        {busy ? "Sending…" : label}
      </Button>
    </div>
  );
}
