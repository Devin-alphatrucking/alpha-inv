/**
 * A reference the phone app puts on a record it creates (an issue, a delivery, a request, a photo). If the same save is sent twice, because
 * the first answer was lost or the app retried, the server finds the record it already made and returns it instead of making a second one.
 * It is random, made on the phone, and only ever compared inside one company and for the same person.
 */
const FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

/** null: none given. false: given but not acceptable. Otherwise the reference. */
export function clientRefOf(raw: unknown): string | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  return typeof raw === "string" && FORMAT.test(raw) ? raw : false;
}

export const BAD_REF = { ok: false as const, error: "That save reference is not valid.", field: "clientRef" };
export const REF_TAKEN = { ok: false as const, error: "That save reference was already used for something else.", field: "clientRef" };

export const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "P2002";
