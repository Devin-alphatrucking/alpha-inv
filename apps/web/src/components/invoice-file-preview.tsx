"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function isPdfUrl(url: string) {
  return /\.pdf($|\?)/i.test(url) || url.includes("application/pdf");
}

function getCleanFileName(url: string) {
  if (!url) return "Document";
  let name = url;
  if (name.startsWith("local://")) {
    name = name.replace(/^local:\/\//, "");
  }
  try {
    const u = new URL(name);
    name = u.pathname;
  } catch {
    // ignore non-URL paths
  }
  const base = name.split(/[/\\]/).pop() ?? name;
  // Strip timestamp prefix like 1787397888247- if present
  const cleaned = base.replace(/^\d{10,14}-/, "");
  return cleaned || base || "Invoice document";
}

export function InvoiceFilePreview({
  invoiceId,
  fileUrl,
  className,
  compact,
}: {
  invoiceId: string;
  fileUrl: string;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const serveUrl = `/api/invoices/${invoiceId}/file`;
  const cleanFileName = useMemo(() => getCleanFileName(fileUrl), [fileUrl]);
  const pdf = isPdfUrl(fileUrl) || isPdfUrl(cleanFileName);

  useEffect(() => {
    if (!open) return;
    const handlePopState = () => {
      setOpen(false);
    };
    window.history.pushState({ modal: "invoice-file-preview" }, "");
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [open]);

  const handleClose = () => {
    if (typeof window !== "undefined" && window.history.state?.modal === "invoice-file-preview") {
      window.history.back();
    } else {
      setOpen(false);
    }
  };

  const handleOpen = () => {
    setZoom(1);
    setRotation(0);
    setOpen(true);
  };

  return (
    <div className={cn("min-w-0 max-w-full", className)}>
      {!compact ? (
        <div className="min-w-0 max-w-full space-y-1.5">
          <div className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0">Source file:</span>
            <button
              type="button"
              className="min-w-0 truncate font-mono text-xs font-medium text-foreground underline-offset-2 hover:underline text-left"
              title={fileUrl}
              onClick={handleOpen}
            >
              {cleanFileName}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleOpen}
            >
              <ZoomIn className="size-3.5" />
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5"
              nativeButton={false}
              render={
                <a href={serveUrl} target="_blank" rel="noreferrer" />
              }
            >
              <ExternalLink className="size-3.5" />
              Open
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={handleOpen}
        >
          <ZoomIn className="size-3.5" />
          Preview
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) handleClose();
          else handleOpen();
        }}
      >
        <DialogContent
          className="flex h-[100dvh] w-screen max-w-none rounded-none border-none p-3 sm:h-auto sm:max-h-[92vh] sm:w-[min(96vw,56rem)] sm:max-w-[56rem] sm:rounded-xl sm:border sm:p-4 flex-col gap-2.5 overflow-hidden bg-background"
          showCloseButton={false}
        >
          {/* Header with prominent Back button for mobile responsiveness */}
          <div className="flex items-center justify-between gap-2 border-b pb-2 sm:pb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 font-medium shrink-0 shadow-xs"
                onClick={handleClose}
              >
                <ArrowLeft className="size-4" />
                <span>Back</span>
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-sm font-semibold truncate sm:text-base">
                    Invoice document
                  </DialogTitle>
                  <Badge variant="secondary" className="text-[10px] uppercase font-mono px-1.5 py-0 shrink-0">
                    {pdf ? "PDF" : "Image"}
                  </Badge>
                </div>
                <DialogDescription className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                  {cleanFileName}
                </DialogDescription>
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleClose}
              aria-label="Close preview"
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Dialog Action bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
            {!pdf ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                >
                  <Minus className="size-3.5" />
                  Zoom out
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                >
                  <Plus className="size-3.5" />
                  Zoom in
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 font-medium"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  title="Rotate clockwise 90°"
                >
                  <RotateCw className="size-3.5" />
                  Rotate {rotation > 0 ? `(${rotation}°)` : ""}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => {
                    setZoom(1);
                    setRotation(0);
                  }}
                >
                  <RotateCcw className="size-3.5" />
                  Reset
                </Button>
                <span className="pl-1 text-xs tabular-nums text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 font-medium"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  title="Rotate clockwise 90°"
                >
                  <RotateCw className="size-3.5" />
                  Rotate {rotation > 0 ? `(${rotation}°)` : ""}
                </Button>
                {rotation > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => setRotation(0)}
                  >
                    <RotateCcw className="size-3.5" />
                    Reset
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  Document preview
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                nativeButton={false}
                render={
                  <a href={serveUrl} download={cleanFileName} />
                }
              >
                <Download className="size-3.5" />
                Download
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                className="gap-1.5"
                nativeButton={false}
                render={
                  <a href={serveUrl} target="_blank" rel="noreferrer" />
                }
              >
                <ExternalLink className="size-3.5" />
                Open full file
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/30">
            {pdf ? (
              <div className="flex h-full min-h-[60vh] flex-col items-center justify-center overflow-hidden">
                <object
                  data={`${serveUrl}#toolbar=0`}
                  type="application/pdf"
                  className="h-[68vh] w-full bg-background transition-transform duration-200 origin-center"
                  style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
                >
                  {/* Fallback when browser/mobile doesn't support embedded PDF */}
                  <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
                    <div className="rounded-2xl bg-primary/10 p-4">
                      <FileText className="size-10 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold">{cleanFileName}</p>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        Mobile browsers don&apos;t support inline PDF rendering. Tap below to view or download the full invoice PDF.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <Button
                        type="button"
                        size="sm"
                        nativeButton={false}
                        render={
                          <a href={serveUrl} target="_blank" rel="noreferrer" />
                        }
                      >
                        <ExternalLink className="size-4" />
                        Open PDF in New Tab
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={
                          <a href={serveUrl} download={cleanFileName} />
                        }
                      >
                        <Download className="size-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                </object>
              </div>
            ) : (
              <div className="flex min-h-[50vh] items-center justify-center p-4 overflow-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={serveUrl}
                  alt="Invoice preview"
                  className="max-w-full rounded-md border bg-background shadow-xs transition-transform duration-200 origin-center"
                  style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                  draggable={false}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
