"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deletePhotoAction } from "./actions";
import { useConfirm } from "@/components/confirm-provider";

export type GridPhoto = { id: string; caption: string | null; area: string | null; takenOn: string; projectName?: string; uploaderName: string | null; canDelete: boolean };

/** Thumbnails of site photos. Each opens full size in a new tab; people who may remove a photo see a bin on it. */
export function PhotoGrid({ photos, showProject = false }: { photos: GridPhoto[]; showProject?: boolean }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const ask = useConfirm();

  async function remove(id: string) {
    if (!(await ask({ title: "Delete this photo?", description: "This cannot be undone.", confirmLabel: "Delete photo", cancelLabel: "Keep it" }))) return;
    setRemoving(id);
    const r = await deletePhotoAction(id);
    setRemoving(null);
    if (r.ok) {
      toast.success("Photo deleted");
      router.refresh();
    } else toast.error(r.error);
  }

  if (photos.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ImageOff className="size-4" aria-hidden /> No photos yet.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Site photos">
      {photos.map((p) => (
        <li key={p.id} className="group relative overflow-hidden rounded-xl border bg-muted/30">
          <a href={`/api/site/photos/${p.id}`} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/site/photos/${p.id}`} alt={p.caption || p.area || "Site photo"} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          </a>
          <div className="grid gap-0.5 px-2.5 py-2 text-xs">
            {p.caption && <p className="line-clamp-2 text-sm">{p.caption}</p>}
            <p className="text-muted-foreground">{[showProject ? p.projectName : null, p.area, p.takenOn].filter(Boolean).join(" · ")}</p>
            {p.uploaderName && <p className="text-muted-foreground">by {p.uploaderName}</p>}
          </div>
          {p.canDelete && (
            <Button type="button" variant="secondary" size="icon-sm" className="absolute right-1.5 top-1.5 opacity-90" disabled={removing === p.id} onClick={() => void remove(p.id)} aria-label="Delete this photo">
              {removing === p.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
