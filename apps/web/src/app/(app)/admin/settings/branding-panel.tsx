"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand-logo";
import { isHexColor, readableOn } from "@/lib/brand/theme";
import { removeLogo, saveBranding, uploadLogo } from "./branding-actions";

export type BrandingValues = {
  companyName: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  supportUrl: string;
  country: string;
  currency: string;
  timezone: string;
};

const FALLBACK_PRIMARY = "#171717";

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={isHexColor(value) ? value : FALLBACK_PRIMARY}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-11 w-14 cursor-pointer rounded-xl border bg-transparent p-1 md:h-10"
        />
        <Input id={id} value={value} placeholder="#0F4C81" onChange={(e) => onChange(e.target.value)} className="w-32 font-mono" />
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Use default
          </Button>
        )}
      </div>
    </div>
  );
}

export function BrandingPanel({ initial }: { initial: BrandingValues }) {
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [logoPending, startLogo] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof BrandingValues>(key: K, value: BrandingValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  const previewName = v.displayName.trim() || v.companyName;
  const previewPrimary = isHexColor(v.primaryColor) ? v.primaryColor : FALLBACK_PRIMARY;

  function save() {
    startTransition(async () => {
      const result = await saveBranding({
        displayName: v.displayName,
        primaryColor: v.primaryColor,
        accentColor: v.accentColor,
        supportEmail: v.supportEmail,
        supportUrl: v.supportUrl,
        country: v.country,
        currency: v.currency,
        timezone: v.timezone,
      });
      if (result.ok) toast.success("Branding saved. Reload the page to see the new colours everywhere.");
      else toast.error(result.error);
    });
  }

  function onPickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.set("logo", file);
    startLogo(async () => {
      const result = await uploadLogo(form);
      if (result.ok) {
        toast.success("Logo updated. Reload the page to see it everywhere.");
        set("logoUrl", URL.createObjectURL(file));
      } else toast.error(result.error);
    });
  }

  function onRemoveLogo() {
    startLogo(async () => {
      const result = await removeLogo();
      if (result.ok) {
        set("logoUrl", null);
        toast.success("Logo removed.");
      } else toast.error(result.error);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="brand-name">Display name</Label>
          <Input
            id="brand-name"
            value={v.displayName}
            maxLength={60}
            placeholder={v.companyName}
            onChange={(e) => set("displayName", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Shown in the header, on the sign-in page and in the browser tab.</p>
        </div>

        <div className="grid gap-2">
          <Label>Logo</Label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-14 min-w-28 items-center rounded-lg border bg-muted/30 px-3">
              <BrandLogo name={previewName} logoUrl={v.logoUrl} />
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPickLogo} />
            <Button type="button" variant="outline" size="sm" disabled={logoPending} onClick={() => fileRef.current?.click()}>
              {logoPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {v.logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {v.logoUrl && (
              <Button type="button" variant="ghost" size="sm" disabled={logoPending} onClick={onRemoveLogo}>
                <Trash2 className="size-4" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 300 KB. A wide logo on a transparent background works best. Check it is readable on BOTH white and dark backgrounds: the app follows each person&apos;s light or dark setting, and white-only artwork disappears on white.</p>
        </div>

        <div className="flex flex-wrap gap-6">
          <ColorField id="brand-primary" label="Main colour" value={v.primaryColor} onChange={(x) => set("primaryColor", x)} />
          <ColorField id="brand-accent" label="Accent colour" value={v.accentColor} onChange={(x) => set("accentColor", x)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="brand-email">Support email</Label>
            <Input id="brand-email" type="email" value={v.supportEmail} placeholder="help@yourcompany.com" onChange={(e) => set("supportEmail", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="brand-url">Support website</Label>
            <Input id="brand-url" value={v.supportUrl} placeholder="https://yourcompany.com/help" onChange={(e) => set("supportUrl", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-4 border-t pt-5 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="brand-country">Country</Label>
            <Input id="brand-country" value={v.country} maxLength={2} className="uppercase" onChange={(e) => set("country", e.target.value.toUpperCase())} />
            <p className="text-xs text-muted-foreground">2 letters, e.g. IN, AU, US.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="brand-currency">Currency</Label>
            <Input id="brand-currency" value={v.currency} maxLength={3} className="uppercase" onChange={(e) => set("currency", e.target.value.toUpperCase())} />
            <p className="text-xs text-muted-foreground">3 letters, e.g. INR, AUD, USD.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="brand-tz">Timezone</Label>
            <Input id="brand-tz" value={v.timezone} onChange={(e) => set("timezone", e.target.value)} />
            <p className="text-xs text-muted-foreground">e.g. Asia/Kolkata. Sets dates and the monthly AI limit reset.</p>
          </div>
        </div>

        <div>
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save branding
          </Button>
        </div>
      </div>

      <div className="h-fit rounded-xl border bg-card p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preview</p>
        <BrandLogo name={previewName} logoUrl={v.logoUrl} />
        <div className="mt-4 grid gap-2">
          <div
            className="rounded-md px-3 py-2 text-center text-sm font-medium"
            style={{ backgroundColor: previewPrimary, color: readableOn(previewPrimary) }}
          >
            Primary button
          </div>
          {isHexColor(v.accentColor) && (
            <div className="rounded-md border-2 px-3 py-2 text-center text-sm font-medium" style={{ borderColor: v.accentColor, color: v.accentColor }}>
              Accent
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Colours are checked for readability: text on buttons switches between white and black automatically.</p>
      </div>
    </div>
  );
}
