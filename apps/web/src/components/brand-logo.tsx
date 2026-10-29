/* eslint-disable @next/next/no-img-element -- logos are served from our own /api/branding route and are small */
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

type Props = {
  name: string;
  logoUrl: string | null;
  /** Height of an uploaded logo image (the monogram uses `size`). */
  className?: string;
  /** Size of the monogram and name shown when there is no logo: sm (compact bars), md (default), lg (sign-in and sign-up pages). */
  size?: Size;
};

const MONOGRAM: Record<Size, { box: string; name: string }> = {
  sm: { box: "size-5 rounded text-[10px]", name: "text-xs" },
  md: { box: "size-7 rounded-md text-xs", name: "text-sm" },
  lg: { box: "size-10 rounded-lg text-sm", name: "text-lg" },
};

/** The company's logo, or a neutral monogram (icon and name, sized together and centred on each other) when it has none. */
export function BrandLogo({ name, logoUrl, className, size = "md" }: Props) {
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
  const m = MONOGRAM[size];
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-primary font-bold leading-none text-primary-foreground", m.box)}>
        {initials || "•"}
      </span>
      <span className={cn("truncate font-semibold leading-none tracking-tight", m.name)}>{name}</span>
    </span>
  );
}
