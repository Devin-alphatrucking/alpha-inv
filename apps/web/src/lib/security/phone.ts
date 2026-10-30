// Mobile numbers: typed the way people write them, stored one way (international format, +<country><number>). Pure rules.

/** Calling codes of the countries a company can be set up in (see COUNTRY_DEFAULTS). */
export const DIAL_CODES: Record<string, string> = { IN: "91", AU: "61", NZ: "64", GB: "44", US: "1", CA: "1", SG: "65", AE: "971", ZA: "27" };

export type PhoneResult = { ok: true; phone: string } | { ok: false; error: string };

const BAD = "Enter a mobile number with its area code, for example 98765 43210 or +91 98765 43210.";

/**
 * "98765 43210", "(098) 765-43210", "+91 98765 43210" and "0091 98765 43210" all become +919876543210 for India.
 * A number without a leading + is read as a number of `country` (the company's country). Anything else must carry
 * its own + and country code. Returns the text to show when it cannot be read.
 */
/** An example number for the country field of a form, written the way people in that country write it. */
export const PHONE_EXAMPLE: Record<string, string> = { IN: "98765 43210", AU: "0412 345 678", NZ: "021 123 4567", GB: "07400 123456", US: "(201) 555-0123", CA: "(204) 555-0123", SG: "8123 4567", AE: "050 123 4567", ZA: "082 123 4567" };

/** What to tell a person typing a mobile number for this country. */
export function phoneHint(country: string): string {
  if (country === "IN") return "10-digit Indian mobile number. No +91 needed.";
  return `A ${country} number as you would dial it locally, or with its country code (+${DIAL_CODES[country] ?? ""}).`;
}

export function normalizePhone(raw: unknown, country = "IN"): PhoneResult {
  if (typeof raw !== "string") return { ok: false, error: BAD };
  const text = raw.trim();
  if (text.length === 0 || text.length > 30) return { ok: false, error: BAD };
  if (!/^\+?[\d\s().-]+$/.test(text)) return { ok: false, error: "Use digits only, with an optional + at the start." };

  let digits = text.replace(/\D/g, "");
  let international = text.startsWith("+");
  if (!international && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }

  let full: string;
  if (international) {
    full = digits;
  } else {
    const dial = DIAL_CODES[country] ?? DIAL_CODES.IN;
    const national = digits.replace(/^0+/, ""); // a leading 0 is the dialling prefix inside a country, not part of the number
    // Someone typed the country code without the + ("919876543210"): do not add it twice.
    full = national.startsWith(dial) && national.length >= dial.length + 8 ? national : dial + national;
  }

  if (full.length < 8 || full.length > 15) return { ok: false, error: BAD };
  if (full.startsWith("0")) return { ok: false, error: BAD };
  // India: the number after 91 is 10 digits and starts with 6 to 9.
  if (full.startsWith("91") && !(full.length === 12 && /^[6-9]/.test(full.slice(2)))) return { ok: false, error: "An Indian mobile number has 10 digits and starts with 6, 7, 8 or 9." };
  return { ok: true, phone: `+${full}` };
}

/** "+919876543210" -> "+91 98765 43210" for showing. Unknown shapes are shown as stored. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return phone;
}
