import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportDataButton({
  dataset = "all",
  format = "xlsx",
  label = "Export data",
  compact = false,
}: {
  dataset?: string;
  format?: "xlsx" | "json";
  label?: string;
  compact?: boolean;
}) {
  const href = `/api/admin/export?dataset=${encodeURIComponent(dataset)}&format=${format}`;
  return (
    <Button
      variant="outline"
      size={compact ? "icon-sm" : "sm"}
      nativeButton={false}
      render={<a href={href} download />}
      aria-label={compact ? label : undefined}
      title={label}
    >
      <Download className="size-4" />
      {!compact && label}
    </Button>
  );
}
