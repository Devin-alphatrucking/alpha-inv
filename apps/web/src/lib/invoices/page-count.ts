import { createHash } from "crypto";
import { PDFDocument } from "pdf-lib";

import { AppError } from "@/lib/errors";

/** Hard ceiling per uploaded file so one upload can't burn a whole month. */
export const MAX_PAGES_PER_FILE = 50;

export function hashFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Number of pages Azure will bill for this file. Images are always 1 page.
 * PDFs are counted from the document itself, before any AI call is made.
 */
export async function countBillablePages(
  buffer: Buffer,
  mimeType: string
): Promise<number> {
  if (mimeType !== "application/pdf") return 1;

  let pages: number;
  try {
    const pdf = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    pages = pdf.getPageCount();
  } catch {
    throw new AppError(
      "VALIDATION_001",
      "This PDF could not be read. It may be damaged or password-protected."
    );
  }

  if (pages < 1) {
    throw new AppError("VALIDATION_001", "This PDF has no pages.");
  }
  if (pages > MAX_PAGES_PER_FILE) {
    throw new AppError(
      "VALIDATION_001",
      `This PDF has ${pages} pages. The limit is ${MAX_PAGES_PER_FILE} pages per file; please split it.`
    );
  }
  return pages;
}
