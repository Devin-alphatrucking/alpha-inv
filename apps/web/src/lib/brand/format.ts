// Number/date formatting driven by the company's country, currency and timezone.
// Pure (no server imports) so client components can use it too.

export type OrgFormat = { currency: string; locale: string; timeZone: string };

/** What the product used before companies had their own settings (India). */
export const DEFAULT_FORMAT: OrgFormat = {
  currency: "INR",
  locale: "en-IN",
  timeZone: "Asia/Kolkata",
};

const LOCALE_BY_COUNTRY: Record<string, string> = {
  IN: "en-IN",
  AU: "en-AU",
  NZ: "en-NZ",
  GB: "en-GB",
  US: "en-US",
  CA: "en-CA",
  SG: "en-SG",
  AE: "en-AE",
  ZA: "en-ZA",
};

export function localeForCountry(country: string | null | undefined): string {
  return (country && LOCALE_BY_COUNTRY[country.toUpperCase()]) || "en";
}

function validCurrency(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{3}$/.test(code)) return null;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code.toUpperCase() });
    return code.toUpperCase();
  } catch {
    return null;
  }
}

export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Build a safe format from raw company settings (falls back to the defaults). */
export function formatFromOrg(org: {
  country?: string | null;
  currency?: string | null;
  timezone?: string | null;
}): OrgFormat {
  return {
    currency: validCurrency(org.currency) ?? DEFAULT_FORMAT.currency,
    locale: localeForCountry(org.country),
    timeZone: validTimeZone(org.timezone) ?? DEFAULT_FORMAT.timeZone,
  };
}

export type Formatters = ReturnType<typeof makeFormatters>;

export function makeFormatters(f: OrgFormat) {
  const toDate = (v: Date | string | number) => (v instanceof Date ? v : new Date(v));
  const symbol =
    new Intl.NumberFormat(f.locale, { style: "currency", currency: f.currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? f.currency;
  return {
    format: f,
    /** Currency symbol, e.g. "₹", "$", "A$". */
    symbol,
    money(value: number, maxFraction = 0) {
      return new Intl.NumberFormat(f.locale, {
        style: "currency",
        currency: f.currency,
        maximumFractionDigits: maxFraction,
      }).format(value);
    },
    date(v: Date | string | number) {
      return toDate(v).toLocaleDateString(f.locale, { timeZone: f.timeZone });
    },
    dateTime(v: Date | string | number) {
      return toDate(v).toLocaleString(f.locale, { timeZone: f.timeZone });
    },
    dateTimeShort(v: Date | string | number) {
      return toDate(v).toLocaleString(f.locale, {
        timeZone: f.timeZone,
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    monthYear(v: Date | string | number) {
      return toDate(v).toLocaleString(f.locale, { timeZone: f.timeZone, month: "short", year: "2-digit" });
    },
  };
}
