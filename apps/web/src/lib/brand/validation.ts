import { z } from "zod";
import { isHexColor } from "./theme";
import { validTimeZone } from "./format";

// Rules for the Branding and region form. Kept out of the "use server" file so it can be unit-tested.
// Blank optional fields become undefined (saved as "not set").

const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const brandingSchema = z.object({
  displayName: z.preprocess(empty, z.string().trim().min(1).max(60).optional()),
  primaryColor: z.preprocess(empty, z.string().refine(isHexColor, "Colour must look like #0F4C81").optional()),
  accentColor: z.preprocess(empty, z.string().refine(isHexColor, "Colour must look like #F59E0B").optional()),
  supportEmail: z.preprocess(empty, z.string().trim().email("Enter a valid support email").max(120).optional()),
  supportUrl: z.preprocess(
    empty,
    z
      .string()
      .trim()
      .max(200)
      .refine((v) => {
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      }, "Support site must be a full https:// address")
      .optional()
  ),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Country must be a 2-letter code, e.g. IN"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code, e.g. INR"),
  timezone: z
    .string()
    .trim()
    .refine((v) => validTimeZone(v) !== null, "Unknown timezone (for example Asia/Kolkata)"),
});

