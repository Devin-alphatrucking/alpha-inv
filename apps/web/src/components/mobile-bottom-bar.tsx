"use client";

import { canOpenPath, hasPermission, type RoleName } from "@/lib/roles";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  FileText,
  Plus,
  Wallet,
  LayoutGrid,
  Boxes,
  Building2,
  Tags,
  Users,
  FolderKanban,
  ScrollText,
  Bug,
  LogOut,
  ChevronRight,
  Settings,
  Download,
  Receipt,
  CalendarRange,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type MobileBottomBarProps = {
  role: RoleName;
  name: string;
  email: string;
};

export function MobileBottomBar({ role, name, email }: MobileBottomBarProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isUploadActive =
    pathname.startsWith("/invoices/upload") || pathname.includes("/review");

  const isMoreActive = [
    "/materials",
    "/vendors",
    "/reports",
    "/categories",
    "/users",
    "/projects",
    "/admin",
  ].some((prefix) => pathname.startsWith(prefix));

  const allMoreItems = [
    {
      href: "/api/admin/export?dataset=all&format=xlsx",
      label: "Download all data",
      description: "Excel workbook with every database table",
      icon: Download,
    },
    {
      href: "/projects",
      label: "Projects",
      description: "Sites, teams & spend per project",
      icon: FolderKanban,
    },
    {
      href: "/payments/planner",
      label: "Payment planner",
      description: "What falls due, and pay several bills at once",
      icon: CalendarRange,
    },
    {
      href: "/reports/gst",
      label: "GST report",
      description: "Tax by month and supplier, CSV",
      icon: Receipt,
    },
    {
      href: "/materials",
      label: "Rate Sheet",
      description: "Live material rates & averages",
      icon: Boxes,
    },
    {
      href: "/materials/compare",
      label: "Price comparison",
      description: "Who sells the same item cheaper",
      icon: Scale,
    },
    {
      href: "/vendors",
      label: "Vendors",
      description: "Material suppliers & GSTINs",
      icon: Building2,
    },
    {
      href: "/categories",
      label: "Categories",
      description: "Material categories & units",
      icon: Tags,
    },
    {
      href: "/users",
      label: "Users",
      description: "User roles & site access",
      icon: Users,
    },
    {
      href: "/admin/activity",
      label: "Activity Logs",
      description: "Audit trail of actions",
      icon: ScrollText,
    },
    {
      href: "/admin/errors",
      label: "Error Logs",
      description: "API errors & request ids",
      icon: Bug,
    },
    {
      href: "/admin/settings",
      label: "Settings",
      description: "Application settings & data reset",
      icon: Settings,
    },
  ];
  // Each person sees only the places their role may open (the same table the sign-in guard uses).
  const adminMoreItems = allMoreItems.filter((item) => canOpenPath(role, item.href));
  // The full bar (with a More sheet) is for people who have somewhere to go besides their own projects and invoices.
  const fullBar = adminMoreItems.some((item) => item.href !== "/projects");
  const canUpload = hasPermission(role, "invoice:upload");
  const canSeePayments = hasPermission(role, "payment:view");
  const tab4 = canSeePayments ? { href: "/payments", label: "Payments", Icon: Wallet } : { href: "/projects", label: "Projects", Icon: FolderKanban };

  return (
    <>
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/70 bg-background/95 backdrop-blur-lg supports-backdrop-filter:bg-background/85 shadow-[0_-4px_24px_rgba(0,0,0,0.07)] md:hidden pb-safe"
      >
        <div className="relative mx-auto flex h-16 max-w-md items-center justify-around px-2">
          {fullBar ? (
            <>
              {/* Dashboard */}
              <Link
                href="/dashboard"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-all duration-150 active:scale-95",
                  pathname === "/dashboard"
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative">
                  <LayoutDashboard className="size-5" />
                  {pathname === "/dashboard" && (
                    <span className="absolute -top-1 right-1/2 translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </div>
                <span>Dashboard</span>
              </Link>

              {/* Invoices */}
              <Link
                href="/invoices"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-all duration-150 active:scale-95",
                  pathname.startsWith("/invoices") && !isUploadActive
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative">
                  <FileText className="size-5" />
                  {pathname.startsWith("/invoices") && !isUploadActive && (
                    <span className="absolute -top-1 right-1/2 translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </div>
                <span>Invoices</span>
              </Link>

              {/* Elevated Center Plus Button */}
              <div className={cn("relative flex flex-1 items-center justify-center", !canUpload && "invisible")} aria-hidden={!canUpload}>
                <Link
                  href="/invoices/upload"
                  aria-label="Upload Invoice"
                  tabIndex={canUpload ? 0 : -1}
                  className={cn(
                    "group relative -top-3.5 flex size-12 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-background transition-all duration-200 active:scale-95 hover:shadow-primary/40 hover:shadow-xl",
                    isUploadActive && "ring-primary/40 ring-offset-2 ring-2"
                  )}
                >
                  <Plus className="size-6 stroke-[2.5] transition-transform duration-200 group-hover:rotate-90 group-active:scale-90" />
                  <span className="text-[9px] font-bold tracking-tight uppercase leading-none -mt-0.5">
                    Upload
                  </span>
                </Link>
              </div>

              {/* Payments */}
              <Link
                href={tab4.href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-all duration-150 active:scale-95",
                  pathname.startsWith(tab4.href)
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative">
                  <tab4.Icon className="size-5" />
                  {pathname.startsWith(tab4.href) && (
                    <span className="absolute -top-1 right-1/2 translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </div>
                <span>{tab4.label}</span>
              </Link>

              {/* More Sheet Trigger */}
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-all duration-150 active:scale-95",
                  isMoreActive
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative">
                  <LayoutGrid className="size-5" />
                  {isMoreActive && (
                    <span className="absolute -top-1 right-1/2 translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </div>
                <span>More</span>
              </button>
            </>
          ) : (
            <>
              {/* STAFF VIEW */}
              {/* Dashboard */}
              <Link
                href="/dashboard"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-all duration-150 active:scale-95",
                  pathname === "/dashboard"
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative">
                  <LayoutDashboard className="size-5" />
                  {pathname === "/dashboard" && (
                    <span className="absolute -top-1 right-1/2 translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </div>
                <span>Dashboard</span>
              </Link>

              {/* My Invoices */}
              <Link
                href="/invoices"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-all duration-150 active:scale-95",
                  pathname.startsWith("/invoices") && !isUploadActive
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative">
                  <FileText className="size-5" />
                  {pathname.startsWith("/invoices") && !isUploadActive && (
                    <span className="absolute -top-1 right-1/2 translate-x-1/2 size-1 rounded-full bg-primary" />
                  )}
                </div>
                <span>My Invoices</span>
              </Link>

              {/* Elevated Center Plus Button */}
              <div className={cn("relative flex flex-1 items-center justify-center", !canUpload && "invisible")} aria-hidden={!canUpload}>
                <Link
                  href="/invoices/upload"
                  aria-label="Upload Invoice"
                  tabIndex={canUpload ? 0 : -1}
                  className={cn(
                    "group relative -top-3.5 flex size-13 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-background transition-all duration-200 active:scale-95 hover:shadow-primary/40 hover:shadow-xl",
                    isUploadActive && "ring-primary/40 ring-offset-2 ring-2"
                  )}
                >
                  <Plus className="size-6 stroke-[2.5] transition-transform duration-200 group-hover:rotate-90 group-active:scale-90" />
                  <span className="text-[9px] font-bold tracking-tight uppercase leading-none -mt-0.5">
                    Upload
                  </span>
                </Link>
              </div>

              {/* Profile / Account */}
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                className="flex flex-1 flex-col items-center justify-center gap-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground active:scale-95"
              >
                <Avatar className="size-5">
                  <AvatarFallback className="text-[9px] bg-muted font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span>Account</span>
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Admin More Menu Bottom Sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl px-4 pb-8 pt-4 sm:max-w-md sm:mx-auto max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader className="text-left pb-3 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold">
                Administration
              </SheetTitle>
              <Badge variant="secondary">{role}</Badge>
            </div>
            <SheetDescription className="text-xs">
              Manage master data, rate sheets, and system users
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-1.5 py-4">
            {adminMoreItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded-xl p-3 transition-colors active:scale-[0.99]",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted text-foreground"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>

          <div className="mt-2 rounded-xl border bg-muted/30 p-3.5 space-y-3">
            <div className="flex items-center gap-3">
              <Avatar className="size-9 shrink-0">
                <AvatarFallback className="text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {email}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Staff Account Sheet */}
      <Sheet open={accountOpen} onOpenChange={setAccountOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl px-4 pb-8 pt-4 sm:max-w-md sm:mx-auto"
        >
          <SheetHeader className="text-left pb-3 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold">
                My Account
              </SheetTitle>
              <Badge variant="secondary">{role}</Badge>
            </div>
            <SheetDescription className="text-xs">
              Logged in staff member
            </SheetDescription>
          </SheetHeader>

          <div className="py-4 space-y-4">
            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3.5">
              <Avatar className="size-11 shrink-0">
                <AvatarFallback className="text-sm font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {email}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Access: Invoice upload &amp; review
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
