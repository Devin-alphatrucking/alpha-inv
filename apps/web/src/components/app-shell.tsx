"use client";

import { ROLE_INFO, type RoleName } from "@/lib/roles";
import { ChevronDown, Download, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { signOut } from "next-auth/react";
import { AppNav } from "@/components/app-nav";
import { LockedNav } from "@/components/locked-nav";
import { MobileBottomBar } from "@/components/mobile-bottom-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProjectSwitcher } from "@/components/project-switcher";
import { BrandLogo } from "@/components/brand-logo";
import { WelcomeGreeting } from "@/components/welcome-greeting";
import { CompanySwitcher } from "@/components/company-switcher";
import type { AddonKey } from "@/lib/addons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AppShellProps = {
  /** The signed-in company's name and logo. */
  brand: { name: string; logoUrl: string | null };
  /** Plan status strip shown above the header (trial days, overdue payment, ended plan). */
  banner?: React.ReactNode;
  /** Companies this person belongs to (the switcher shows only when there is more than one). */
  companies: { id: string; name: string; role: string }[];
  currentOrgId: string;
  role: RoleName;
  name: string;
  email: string;
  projects: { id: string; name: string; status: string }[];
  selectedProjectId: string | null;
  /** Our own team only: shows a link to the master console. */
  isPlatformAdmin?: boolean;
  /** Trial over, plan ended or unpaid: only the Choose-a-plan screens are reachable and no company data is shown in the header. */
  locked?: boolean;
  /** Optional add-on modules this company has switched on (they get a place in the menu). */
  addons?: AddonKey[];
  children: React.ReactNode;
};

export function AppShell({ brand, banner, companies, currentOrgId, role, name, email, projects, selectedProjectId, isPlatformAdmin, locked, addons = [], children }: AppShellProps) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-dvh bg-muted/30">
      <WelcomeGreeting name={name} company={companies.find((c) => c.id === currentOrgId)?.name ?? brand.name} />
      {/* Desktop Sidebar (visible on md and up) */}
      <aside className="sticky top-0 print:hidden hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="border-b border-sidebar-border px-5 py-5">
          <BrandLogo name={brand.name} logoUrl={brand.logoUrl} />
          <p className="mt-1 text-xs text-muted-foreground">Invoice &amp; Billing</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {locked ? <LockedNav role={role} variant="side" /> : <AppNav role={role} addons={addons} />}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="print:hidden">{banner}</div>
        {/* Top Header */}
        <header className="sticky top-0 z-40 print:hidden flex h-14 items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-4 backdrop-blur sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {/* Mobile App Brand Title */}
            <div className="md:hidden">
              <BrandLogo name={brand.name} logoUrl={brand.logoUrl} size="sm" className="h-5" />
            </div>
            <div className="min-w-0 flex-1 md:max-w-xs">
              {!locked && (
                <ProjectSwitcher role={role} projects={projects} selectedProjectId={selectedProjectId} />
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {!locked && <CompanySwitcher companies={companies} currentOrgId={currentOrgId} />}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-10 shrink-0 items-center gap-2 rounded-full pr-1 outline-none ring-offset-background hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:pr-3"
                aria-label="Open account menu"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden min-w-0 text-left lg:block">
                  <span className="block max-w-36 truncate text-sm font-medium leading-tight">{name}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{ROLE_INFO[role].label}</span>
                </span>
                <ChevronDown className="hidden size-3.5 text-muted-foreground lg:block" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-64 p-1.5">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-9 shrink-0">
                        <AvatarFallback className="text-xs font-semibold">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                        <p className="truncate text-xs font-normal text-muted-foreground">{email}</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{ROLE_INFO[role].label}</Badge>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<a href="/account" />} className="px-2 py-2">
                    <UserRound className="size-4" />
                    Account
                  </DropdownMenuItem>
                  {isPlatformAdmin && (
                    <DropdownMenuItem render={<a href="/master" />} className="px-2 py-2">
                      <ShieldCheck className="size-4" />
                      Master console
                    </DropdownMenuItem>
                  )}
                  {role === "ADMIN" && !locked && (
                    <>
                      <DropdownMenuItem render={<a href="/admin/settings" />} className="px-2 py-2">
                        <Settings className="size-4" />
                        Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        render={<a href="/api/admin/export?dataset=all&format=xlsx" download />}
                        className="px-2 py-2"
                      >
                        <Download className="size-4" />
                        Download all data
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="px-2 py-2"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content with bottom padding on mobile for MobileBottomBar */}
        <main className="flex-1 px-4 py-5 pb-28 sm:px-6 sm:py-6 sm:pb-8 lg:px-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (visible only on mobile) */}
      {locked ? <LockedNav role={role} variant="bar" /> : <MobileBottomBar role={role} name={name} email={email} addons={addons} />}
    </div>
  );
}
