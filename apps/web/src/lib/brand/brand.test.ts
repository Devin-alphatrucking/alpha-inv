// Run with: npx tsx apps/web/src/lib/brand/brand.test.ts
import assert from "node:assert/strict";
import { brandCss, contrastRatio, forDarkMode, isHexColor, readableOn } from "./theme";
import { DEFAULT_FORMAT, formatFromOrg, localeForCountry, makeFormatters } from "./format";
import { detectLogoType } from "./logo";
import { brandingSchema } from "./validation";

// colours: only strict #RRGGBB is accepted
assert.ok(isHexColor("#0F4C81") && isHexColor("#abcdef"));
for (const bad of ["red", "#fff", "#12345", "#1234567", "javascript:1", "#12345g", "} body{display:none", null, undefined, 5]) {
  assert.equal(isHexColor(bad), false, String(bad));
}
assert.equal(readableOn("#ffffff"), "#111111");
assert.equal(readableOn("#000000"), "#ffffff");
assert.equal(readableOn("#0F4C81"), "#ffffff");
assert.equal(readableOn("#FFD600"), "#111111");
assert.ok(contrastRatio("#000000", "#ffffff") > 20);
assert.notEqual(forDarkMode("#050505"), "#050505", "very dark brand colours are lightened in dark mode");
assert.equal(forDarkMode("#F59E0B"), "#F59E0B");
const css = brandCss({ primary: "#0F4C81", accent: "#F59E0B" });
assert.match(css, /:root\{--primary:#0F4C81;/);
assert.match(css, /\.dark\{--primary:/);
assert.match(css, /--brand-accent:#F59E0B/);
assert.equal(brandCss({}), "");
assert.equal(brandCss({ primary: "</style><script>", accent: "red" }), "", "invalid values produce nothing");
assert.ok(!/[<>"'\\]/.test(css), "no markup characters can appear in the generated css");

// formatting
assert.equal(localeForCountry("IN"), "en-IN");
assert.equal(localeForCountry("au"), "en-AU");
assert.equal(localeForCountry("ZZ"), "en");
assert.deepEqual(formatFromOrg({ country: "IN", currency: "INR", timezone: "Asia/Kolkata" }), DEFAULT_FORMAT);
assert.deepEqual(formatFromOrg({ country: "AU", currency: "aud", timezone: "Australia/Sydney" }), {
  currency: "AUD",
  locale: "en-AU",
  timeZone: "Australia/Sydney",
});
assert.equal(formatFromOrg({ currency: "XXXX", timezone: "Mars/Base" }).currency, "INR", "bad currency falls back");
assert.equal(formatFromOrg({ currency: "INR", timezone: "Mars/Base" }).timeZone, "Asia/Kolkata", "bad timezone falls back");
const inr = makeFormatters(DEFAULT_FORMAT);
assert.match(inr.money(1234567), /₹\s?12,34,567/);
assert.equal(inr.symbol, "₹");
const aud = makeFormatters({ currency: "AUD", locale: "en-AU", timeZone: "Australia/Sydney" });
assert.match(aud.money(1234.5, 2), /\$1,234\.50/);
// the same instant lands on different calendar days in different company timezones
const instant = new Date("2026-10-21T20:00:00Z"); // Oct 22 in Kolkata and Sydney is Oct 22 06:00 / Oct 22
const la = makeFormatters({ currency: "USD", locale: "en-US", timeZone: "America/Los_Angeles" });
assert.match(la.date(instant), /10\/21\/2026/);
assert.match(inr.date(instant), /22\/10\/2026/);
assert.ok(inr.monthYear(new Date("2026-03-15T12:00:00Z")).includes("26"));

// logo type sniffing
assert.equal(detectLogoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
assert.equal(detectLogoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
assert.equal(detectLogoType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
assert.equal(detectLogoType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null, "svg refused");
assert.equal(detectLogoType(new TextEncoder().encode("<?php echo 1;")), null);
assert.equal(detectLogoType(new Uint8Array([])), null);


// branding form validation
const base = { displayName: "Acme Builders", primaryColor: "#0F4C81", accentColor: "#F59E0B", supportEmail: "help@acme.com", supportUrl: "https://acme.com/help", country: "in", currency: "inr", timezone: "Asia/Kolkata" };
const ok = brandingSchema.safeParse(base);
assert.ok(ok.success);
assert.equal(ok.success && ok.data.country, "IN");
assert.equal(ok.success && ok.data.currency, "INR");
const blank = brandingSchema.safeParse({ ...base, displayName: "", primaryColor: "", accentColor: "  ", supportEmail: "", supportUrl: "" });
assert.ok(blank.success && blank.data.displayName === undefined && blank.data.primaryColor === undefined && blank.data.supportUrl === undefined, "blank optional fields mean 'not set'");
for (const bad of [
  { primaryColor: "blue" }, { primaryColor: "#12" }, { accentColor: "url(x)" },
  { supportEmail: "not-an-email" }, { supportUrl: "http://acme.com" }, { supportUrl: "javascript:alert(1)" },
  { country: "India" }, { currency: "RUPEE" }, { timezone: "Mars/Base" }, { displayName: "x".repeat(61) },
]) {
  assert.equal(brandingSchema.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad));
}

console.log("brand: all checks passed");
