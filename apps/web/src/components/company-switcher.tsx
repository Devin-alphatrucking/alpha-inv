"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchCompanyAction } from "@/app/(app)/account/actions";

/** The company menu. Everyone has it: it lists the companies you belong to (switch between them) and starts a company of your own. */
export function CompanySwitcher({
  companies,
  currentOrgId,
}: {
  companies: { id: string; name: string; role: string }[];
  currentOrgId: string;
}) {
  const [pending, start] = useTransition();
  const current = companies.find((c) => c.id === currentOrgId);

  function choose(id: string) {
    if (id === currentOrgId) return;
    start(async () => {
      const r = await switchCompanyAction(id);
      if (r.ok) window.location.assign("/dashboard");
      else toast.error(r.error);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="max-w-[180px] shrink-0 gap-1.5 max-sm:aspect-square max-sm:px-0" disabled={pending} aria-label="Switch company">
            <Building2 className="size-4 shrink-0" />
            <span className="hidden truncate sm:inline">{current?.name ?? "Company"}</span>
            <ChevronsUpDown className="hidden size-3.5 shrink-0 opacity-60 sm:block" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground">Your companies</DropdownMenuLabel>
          {companies.map((c) => (
            <DropdownMenuItem key={c.id} className="px-2 py-2" onClick={() => choose(c.id)}>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.id === currentOrgId && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="/account#new-company" />} className="px-2 py-2 text-muted-foreground">
          <Plus className="size-4" />
          Start a company of your own
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
