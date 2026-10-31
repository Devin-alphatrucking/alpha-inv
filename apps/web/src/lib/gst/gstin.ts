// GSTIN checks: is this a well-formed Indian GST number, and does its last character agree with the rest?
// Pure functions, unit-tested (gstin.test.ts). A mistyped or misread digit almost always breaks the check character,
// so this catches reading mistakes before they reach a GST return. It cannot say whether a GSTIN is REGISTERED or active.

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The state or union territory a GSTIN's first two digits stand for. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

/** The same list as [code, name] pairs in code order, for dropdowns. */
export const GST_STATE_LIST: [string, string][] = Object.entries(GST_STATES).sort(([a], [b]) => a.localeCompare(b));

/** The check character the first 14 characters should be followed by (the standard mod-36 scheme used for GSTINs). */
export function gstinCheckChar(first14: string): string | null {
  if (!/^[0-9A-Z]{14}$/.test(first14)) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export type GstinCheck = { ok: true; state: string } | { ok: false; reason: string };

/** Spaces and dashes are ignored and letters may be any case: what people type and what is printed on bills. */
export const cleanGstin = (raw: string) => raw.replace(/[\s-]+/g, "").toUpperCase();

/** Whether a GSTIN is well formed, has a real state code, and passes its check character. An empty value is `ok: false` too: use `hasValue` first. */
export function checkGstin(raw: string | null | undefined): GstinCheck {
  const g = cleanGstin(raw ?? "");
  if (g.length !== 15) return { ok: false, reason: `A GSTIN has 15 characters; this has ${g.length}.` };
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { ok: false, reason: "The characters are not in the GSTIN pattern (2 digits, 5 letters, 4 digits, a letter, then 3 more)." };
  const state = GST_STATES[g.slice(0, 2)];
  if (!state) return { ok: false, reason: `${g.slice(0, 2)} is not a state code used in GSTINs.` };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { ok: false, reason: "The last character does not match the rest, so a digit or letter is probably wrong." };
  return { ok: true, state };
}

export const hasValue = (raw: string | null | undefined) => cleanGstin(raw ?? "") !== "";
