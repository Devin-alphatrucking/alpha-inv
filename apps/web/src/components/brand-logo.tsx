/* eslint-disable @next/next/no-img-element -- logos are served from our own /api/branding route and are small */
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  logoUrl: string | null;
  className?: string;
};

/** The company's logo, or a neutral monogram when it has none. */
export function BrandLogo({ name, logoUrl, className }: Props) {
  if (logoUrl) {
    return <img src={logoUrl} alt={name} className={cn("h-7 w-auto max-w-[160px] object-contain object-left", className)} />;
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
      >
        {initials || "•"}
      </span>
      <span className={cn("truncate text-sm font-semibold", className)}>{name}</span>
    </span>
  );
}
