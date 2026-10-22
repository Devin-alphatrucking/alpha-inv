"use client";

import { Building2, Download, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { signOut } from "next-auth/react";
import { AppNav } from "@/components/app-nav";
import { MobileBottomBar } from "@/components/mobile-bottom-bar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProjectSwitcher } from "@/components/project-switcher";
import { BrandLogo } from "@/components/brand-logo";
import { ExportDataButton } from "@/components/export-data-button";
import { CompanySwitcher } from "@/components/company-switcher";
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
  role: "ADMIN" | "STAFF";
  name: string;
  email: string;
  projects: { id: string; name: string; status: string }[];
  selectedProjectId: string | null;
  /** Our own team only: shows a link to the master console. */
  isPlatformAdmin?: boolean;
  children: React.ReactNode;
};

export function AppShell({ brand, banner, companies, currentOrgId, role, name, email, projects, selectedProjectId, isPlatformAdmin, children }: AppShellProps) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-dvh bg-muted/30">
      {/* Desktop Sidebar (visible on md and up) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="border-b border-sidebar-border px-5 py-5">
          <BrandLogo name={brand.name} logoUrl={brand.logoUrl} />
          <p className="mt-1 text-xs text-muted-foreground">Invoice &amp; Billing</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <AppNav role={role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        {/* Top Header */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-border/80 bg-background px-4 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {/* Mobile App Brand Title */}
            <div className="md:hidden">
              <BrandLogo name={brand.name} logoUrl={brand.logoUrl} className="h-5" />
            </div>
            <div className="min-w-0 flex-1 md:max-w-xs">
              <ProjectSwitcher
                role={role}
                projects={projects}
                selectedProjectId={selectedProjectId}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            {role === "ADMIN" && (
              <div className="hidden sm:block">
                <ExportDataButton label="Download all data" />
              </div>
            )}
            <Badge
              variant="secondary"
              className="hidden text-[11px] font-semibold sm:inline-flex"
            >
              {role}
            </Badge>
            <Avatar className="hidden size-8 shrink-0 sm:flex">
              <AvatarFallback className="text-xs font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div className="hidden min-w-0 text-right lg:block">
              <p className="truncate text-sm font-medium leading-none">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex size-9 shrink-0 items-center justify-center rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
                aria-label="Open account menu"
              >
                <Avatar className="size-9">
                  <AvatarFallback className="text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
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
                      <Badge variant="secondary" className="text-[10px]">{role}</Badge>
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
                  {role === "ADMIN" && (
                    <>
                      <DropdownMenuItem
                        render={<a href="/api/admin/export?dataset=all&format=xlsx" download />}
                        className="px-2 py-2"
                      >
                        <Download className="size-4" />
                        Download all data
                      </DropdownMenuItem>
                      <DropdownMenuItem render={<a href="/admin/settings" />} className="px-2 py-2">
                        <Settings className="size-4" />
                        Settings
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
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
            {companies.length > 1 && <CompanySwitcher companies={companies} currentOrgId={currentOrgId} />}
            {isPlatformAdmin && (
              <Button variant="ghost" size="sm" className="hidden shrink-0 sm:inline-flex" render={<a href="/master" />} nativeButton={false}>
                <ShieldCheck className="size-4" />
                Master
              </Button>
            )}
            <Button variant="ghost" size="sm" className="hidden shrink-0 sm:inline-flex" render={<a href="/account" />} nativeButton={false}>
              <UserRound className="size-4" />
              Account
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden shrink-0 sm:inline-flex"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Sign out
            </Button>
          </div>
        </header>

        {/* Main Content with bottom padding on mobile for MobileBottomBar */}
        <main className="flex-1 px-4 py-5 pb-28 sm:px-6 sm:py-6 sm:pb-8 lg:px-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (visible only on mobile) */}
      <MobileBottomBar role={role} name={name} email={email} />
    </div>
  );
}
