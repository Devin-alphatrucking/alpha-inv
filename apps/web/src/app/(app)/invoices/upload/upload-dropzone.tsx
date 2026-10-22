"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createCategoryInline } from "@/app/(app)/invoices/[id]/review/actions";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/jpg";
const ACCEPT_IMAGES = "image/png,image/jpeg,image/jpg";
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

type Stage = "idle" | "uploading" | "extracting" | "done" | "error";

export type UploadCategory = { id: string; name: string };
export type UploadProject = { id: string; name: string; status: string };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowedFile(file: File) {
  if (ALLOWED.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg";
}

export function UploadDropzone({
  categories: initialCategories,
  projects,
  initialProjectId,
}: {
  categories: UploadCategory[];
  projects: UploadProject[];
  initialProjectId: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState(initialCategories);
  const [categoryId, setCategoryId] = useState(initialCategories[0]?.id ?? "");
  const [projectId, setProjectId] = useState(
    initialProjectId ?? (projects.length === 1 ? projects[0].id : "")
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, startCreateCategory] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const categoryItems = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.name })),
    [categories]
  );
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId]
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pickFile = useCallback((next: File | null) => {
    setError(null);
    if (!next) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!isAllowedFile(next)) {
      setError("Only PDF, JPG, or PNG files are supported.");
      toast.error("Only PDF, JPG, or PNG files are supported.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setError("File must be 20MB or smaller.");
      toast.error("File must be 20MB or smaller.");
      return;
    }
    setFile(next);
    setPreviewUrl(
      next.type.startsWith("image/") ? URL.createObjectURL(next) : null
    );
    setStage("idle");
  }, []);

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    pickFile(dropped);
  }

  function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) {
      toast.error("Enter a category name");
      return;
    }
    startCreateCategory(async () => {
      try {
        const created = await createCategoryInline({ name });
        setCategories((prev) => {
          if (prev.some((c) => c.id === created.id)) return prev;
          return [...prev, { id: created.id, name: created.name }].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
        });
        setCategoryId(created.id);
        setNewCategoryName("");
        toast.success(`Category “${created.name}” added`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create category"
        );
      }
    });
  }

  async function handleUpload() {
    if (!file || stage === "uploading" || stage === "extracting") return;
    if (!categoryId) {
      setError("Select a category for this invoice first.");
      toast.error("Select a category before extracting");
      return;
    }
    if (!projectId) {
      setError("Select the project this invoice belongs to.");
      toast.error("Select a project before extracting");
      return;
    }

    setError(null);
    setStage("uploading");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("categoryId", categoryId);
    formData.append("projectId", projectId);

    const extractingTimer = window.setTimeout(() => {
      setStage("extracting");
    }, 600);

    try {
      const res = await fetch("/api/invoices/upload", {
        method: "POST",
        body: formData,
      });
      window.clearTimeout(extractingTimer);
      const data = (await res.json()) as {
        error?: string;
        reviewUrl?: string;
        duplicateWarning?: boolean;
      };
      if (!res.ok) {
        setStage("error");
        setError(data.error ?? "Upload failed");
        toast.error(data.error ?? "Upload failed");
        return;
      }
      setStage("done");
      if (data.duplicateWarning) {
        toast.warning(
          "A similar invoice number already exists — please verify carefully."
        );
      } else {
        toast.success("Extraction complete — opening review");
      }
      router.push(data.reviewUrl ?? "/invoices");
    } catch {
      window.clearTimeout(extractingTimer);
      setStage("error");
      setError(
        "Network error while uploading. Check your connection and try again."
      );
      toast.error("Network error while uploading");
    }
  }

  const busy =
    stage === "uploading" || stage === "extracting" || stage === "done";
  const isPdf =
    file?.type === "application/pdf" ||
    file?.name.toLowerCase().endsWith(".pdf");
  const canExtract = Boolean(file && projectId && categoryId && !busy);
  const hasCategories = categories.length > 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <section className="space-y-3 sm:space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="upload-project" className="text-sm font-medium">
            Project <span className="text-destructive">*</span>
          </Label>
          <Select
            value={projectId || null}
            onValueChange={(value) => setProjectId(value ?? "")}
            items={projects.map((project) => ({ value: project.id, label: project.name }))}
            disabled={busy || projects.length === 0}
          >
            <SelectTrigger id="upload-project" size="lg" className="w-full">
              <SelectValue placeholder="Select project…" />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The invoice, review, payments, and reports will stay with this project.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="upload-category" className="text-sm font-medium">
            Invoice category <span className="text-destructive">*</span>
          </Label>
          <Select
            value={categoryId || null}
            onValueChange={(value) => setCategoryId(value ?? "")}
            items={categoryItems}
            disabled={busy || !hasCategories}
          >
            <SelectTrigger
              id="upload-category"
              size="lg"
              className="w-full"
            >
              <SelectValue placeholder="Select category…" />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!hasCategories ? (
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              No categories yet — create one below to continue.
            </p>
          ) : selectedCategory ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Selected:{" "}
              <span className="font-medium text-foreground">
                {selectedCategory.name}
              </span>
              . You can change this later on review.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Pick the material type for this invoice.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="new-category"
            className="text-xs font-medium text-muted-foreground"
          >
            Or create a new category
          </Label>
          <div className="flex gap-2">
            <Input
              id="new-category"
              value={newCategoryName}
              disabled={busy || creatingCategory}
              placeholder="e.g. Tile Adhesive"
              className="h-11 flex-1 rounded-xl"
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateCategory();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 gap-1.5 rounded-xl px-4 font-medium"
              disabled={busy || creatingCategory || !newCategoryName.trim()}
              onClick={handleCreateCategory}
            >
              {creatingCategory ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add
            </Button>
          </div>
        </div>
      </section>

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload invoice file"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!busy) inputRef.current?.click();
          }
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        className={cn(
          "relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-all duration-300 sm:min-h-[220px] sm:px-8 sm:py-10",
          dragging &&
            "scale-[1.01] border-primary bg-primary/5 shadow-md ring-4 ring-primary/10",
          !dragging && !busy && "hover:border-foreground/25 hover:bg-muted/40",
          busy && "pointer-events-none",
          stage === "error" && "border-destructive/50 bg-destructive/5",
          stage === "done" && "border-emerald-500/40 bg-emerald-50/50"
        )}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-4 px-2">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
              <div className="relative rounded-full bg-muted p-4">
                {stage === "done" ? (
                  <CheckCircle2 className="size-9 text-emerald-600" />
                ) : (
                  <Loader2 className="size-9 animate-spin text-foreground" />
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold tracking-tight">
                {stage === "uploading" && "Uploading file…"}
                {stage === "extracting" && "Reading invoice with AI…"}
                {stage === "done" && "Ready — opening review"}
              </p>
              <p className="max-w-xs text-sm text-muted-foreground">
                {stage === "uploading" && "Saving your document securely."}
                {stage === "extracting" &&
                  "Azure Document Intelligence is extracting vendor, totals, and line items. This can take a few seconds."}
                {stage === "done" && "Taking you to the verify screen."}
              </p>
            </div>
            <div className="flex w-full max-w-xs gap-1.5 pt-1">
              {(["uploading", "extracting", "done"] as const).map((s, i) => {
                const order = { uploading: 0, extracting: 1, done: 2 } as const;
                const current = order[stage as keyof typeof order] ?? 0;
                const active = current >= i;
                return (
                  <div
                    key={s}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-colors duration-500",
                      active ? "bg-primary" : "bg-muted"
                    )}
                  />
                );
              })}
            </div>
          </div>
        ) : file ? (
          <div className="flex w-full max-w-md flex-col items-center gap-3 px-1">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Invoice preview"
                className="max-h-36 w-full rounded-lg border object-contain shadow-sm transition-transform duration-300 sm:max-h-44"
              />
            ) : (
              <div className="rounded-full bg-muted p-4">
                {isPdf ? (
                  <FileText className="size-9 text-muted-foreground" />
                ) : (
                  <ImageIcon className="size-9 text-muted-foreground" />
                )}
              </div>
            )}
            <div className="min-w-0 space-y-1 px-2">
              <p className="truncate text-sm font-semibold">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)} · Ready to extract
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                setPreviewUrl(null);
                setError(null);
                setStage("idle");
                if (inputRef.current) inputRef.current.value = "";
                if (cameraRef.current) cameraRef.current.value = "";
              }}
            >
              <X className="size-3.5" />
              Choose a different file
            </Button>
          </div>
        ) : (
          <>
            <div
              className={cn(
                "rounded-full bg-muted p-4 transition-transform duration-300",
                dragging && "scale-110 bg-primary/10"
              )}
            >
              <UploadCloud
                className={cn(
                  "size-8 text-muted-foreground transition-colors sm:size-10",
                  dragging && "text-primary"
                )}
              />
            </div>
            <div className="space-y-1 px-1">
              <p className="text-base font-semibold tracking-tight sm:text-lg">
                {dragging ? "Drop to upload" : "Drag & drop your invoice"}
              </p>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Supports PDF, JPG, PNG up to 20MB
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 gap-1.5 rounded-xl px-3.5 text-xs font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                <FileText className="size-3.5" />
                Browse files
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 rounded-xl px-3.5 text-xs font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  cameraRef.current?.click();
                }}
              >
                <Camera className="size-3.5" />
                Use camera
              </Button>
            </div>
          </>
        )}

        <input
          ref={inputRef}
          id="invoice-file"
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={cameraRef}
          type="file"
          accept={ACCEPT_IMAGES}
          capture="environment"
          className="hidden"
          disabled={busy}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-relaxed text-destructive"
        >
          {error}
        </div>
      )}

      <div className="pt-1">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full gap-2 rounded-xl text-sm font-semibold shadow-sm transition-all"
          disabled={!canExtract}
          onClick={() => void handleUpload()}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {stage === "uploading"
                ? "Uploading file…"
                : stage === "extracting"
                  ? "Extracting invoice with AI…"
                  : "Opening review…"}
            </>
          ) : !file ? (
            <>
              <UploadCloud className="size-4" />
              Select or snap an invoice to extract
            </>
          ) : !projectId ? (
            "Select a project above to continue"
          ) : !categoryId ? (
            "Select category above to continue"
          ) : (
            <>
              <UploadCloud className="size-4" />
              Extract invoice data
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
