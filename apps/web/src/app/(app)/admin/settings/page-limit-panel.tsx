"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCompanyPageLimit } from "./actions";

export function PageLimitPanel({
  initialLimit,
  used,
  period,
}: {
  initialLimit: number | null;
  used: number;
  period: string;
}) {
  const [value, setValue] = useState(initialLimit === null ? "" : String(initialLimit));
  const [pending, startTransition] = useTransition();

  function save() {
    const trimmed = value.trim();
    const limit = trimmed === "" ? null : Number(trimmed);
    startTransition(async () => {
      const result = await updateCompanyPageLimit(limit);
      if (result.ok) toast.success(limit === null ? "Company cap removed" : "Company cap saved");
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {period}: <span className="font-medium text-foreground">{used}</span> pages used
        {initialLimit !== null ? ` of ${initialLimit}` : " (no company cap set)"}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="company-page-limit">Company-wide monthly page cap</Label>
          <Input
            id="company-page-limit"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Leave empty for no cap"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="sm:w-64"
          />
        </div>
        <Button type="button" onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save cap
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The cap applies across all projects together. Each project also has its own
        monthly limit (set in Projects). Uploads stop when either is reached.
      </p>
    </div>
  );
}
