/** "BANK_TRANSFER" (older records) and "bank transfer" both read as "Bank transfer"; short codes such as NEFT, UPI and RTGS stay as they are. */
export function paymentModeLabel(mode: string | null | undefined): string {
  const raw = (mode ?? "").trim();
  if (!raw) return "Other";
  if (!raw.includes("_")) return raw;
  const words = raw.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
