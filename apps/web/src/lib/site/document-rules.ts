// Drawings and documents: what may be uploaded, how revisions are named, how files are served. Pure functions, unit-tested (document-rules.test.ts).
import { cleanText, isYmd } from "@/lib/site/rules";

type Fail = { ok: false; error: string; field?: string };
const bad = (error: string, field?: string): Fail => ({ ok: false, error, field });
const chars = (s: string) => [...s].length;
const oneLine = (raw: unknown) => cleanText(raw).replace(/\s*\n\s*/g, " ");

export const DOCUMENT_MAX_BYTES = 30 * 1024 * 1024;

export const CATEGORIES = ["ARCHITECTURAL", "STRUCTURAL", "MEP", "SITE_PLAN", "SPECIFICATION", "CONTRACT", "OTHER"] as const;
export type DocCategory = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<DocCategory, string> = {
  ARCHITECTURAL: "Architectural", STRUCTURAL: "Structural", MEP: "MEP (services)", SITE_PLAN: "Site plan", SPECIFICATION: "Specification", CONTRACT: "Contract", OTHER: "Other",
};

// ---- file formats

export type DocFormat = { ext: string; contentType: string; label: string; inline: boolean };

/** Formats that can be kept. `inline` ones open in the browser; the rest download. */
export const FORMATS: DocFormat[] = [
  { ext: "pdf", contentType: "application/pdf", label: "PDF", inline: true },
  { ext: "jpg", contentType: "image/jpeg", label: "JPEG", inline: true },
  { ext: "png", contentType: "image/png", label: "PNG", inline: true },
  { ext: "webp", contentType: "image/webp", label: "WebP", inline: true },
  { ext: "dwg", contentType: "application/acad", label: "AutoCAD DWG", inline: false },
  { ext: "dxf", contentType: "application/dxf", label: "AutoCAD DXF", inline: false },
  { ext: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word", inline: false },
  { ext: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel", inline: false },
  { ext: "pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint", inline: false },
];
export const ACCEPTED_EXTENSIONS = [...FORMATS.map((f) => f.ext), "jpeg"];

const byExt = (ext: string) => FORMATS.find((f) => f.ext === (ext === "jpeg" ? "jpg" : ext));
export const formatOf = (contentType: string) => FORMATS.find((f) => f.contentType === contentType);

const ascii = (head: Uint8Array, from: number, to: number) => String.fromCharCode(...head.slice(from, to));
const startsWith = (head: Uint8Array, text: string) => head.length >= text.length && ascii(head, 0, text.length) === text;

export function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * Decides what a file really is from its first bytes AND its name (a name alone proves nothing, bytes alone cannot tell a Word file from an Excel file).
 * `head` should be the first 4 KB or more of the file. The type kept is ours, never the one the browser claims.
 */
export function checkDocumentFile(head: Uint8Array, size: number, fileName: string): { ok: true; format: DocFormat } | Fail {
  if (size <= 0) return bad("The file is empty.", "file");
  if (size > DOCUMENT_MAX_BYTES) return bad(`A file must be ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB or smaller.`, "file");
  const ext = extensionOf(fileName);
  const format = byExt(ext);
  if (!format) return bad(`This file type is not accepted. Use ${FORMATS.map((f) => f.label).join(", ")}.`, "file");

  let looksRight = false;
  switch (format.ext) {
    case "pdf": looksRight = startsWith(head, "%PDF-"); break;
    case "jpg": looksRight = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff; break;
    case "png": looksRight = head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === "PNG"; break;
    case "webp": looksRight = head.length >= 12 && startsWith(head, "RIFF") && ascii(head, 8, 12) === "WEBP"; break;
    case "dwg": looksRight = startsWith(head, "AC10"); break; // AC1009 ... AC1032
    case "dxf": looksRight = /^\s*(999\s*\r?\n[^\r\n]*\r?\n\s*)?0\s*\r?\nSECTION/.test(ascii(head, 0, Math.min(head.length, 300))); break;
    case "docx":
    case "xlsx":
    case "pptx": {
      // An Office file is a zip with these parts near the start.
      const text = ascii(head, 0, Math.min(head.length, 4096));
      looksRight = head.length > 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 && text.includes("[Content_Types].xml");
      break;
    }
  }
  return looksRight ? { ok: true, format } : bad(`This does not look like a real ${format.label} file. Check the file and try again.`, "file");
}

/** A name that is safe in a download header and on disk. */
export function safeFileName(raw: string): string {
  const base = raw.replace(/^.*[\\/]/, "").replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  const cut = [...base].slice(-120).join("");
  return cut || "file";
}

/** How a file is sent to the browser: where it may open in the page, and the header values that keep it from running as anything else. */
export function servingHeaders(format: DocFormat, fileName: string): Record<string, string> {
  const ascii = safeFileName(fileName).replace(/"/g, "");
  return {
    "Content-Type": format.contentType,
    "Content-Disposition": `${format.inline ? "inline" : "attachment"}; filename="${ascii}"`,
    "X-Content-Type-Options": "nosniff",
    // A PDF or image opened from here can not run scripts or load anything else.
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=300",
  };
}

// ---- document details

export type DocumentInput = { title: string; number: string | null; category: DocCategory; description: string | null; revision: string; note: string | null; issuedOn: string };

export function parseRevisionLabel(raw: unknown): { ok: true; value: string } | Fail {
  const v = oneLine(raw).toUpperCase();
  if (v === "") return bad("Give the revision a name such as A, B or R1.", "revision");
  if (chars(v) > 12 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(v)) return bad("Use up to 12 letters, numbers, dots or dashes for the revision (for example A, R2, 01).", "revision");
  return { ok: true, value: v };
}

export function parseDocument(raw: unknown, today: string, opts: { forNewDocument: boolean } = { forNewDocument: true }): { ok: true; value: DocumentInput } | Fail {
  const i = (raw ?? {}) as Record<string, unknown>;
  const title = oneLine(i.title);
  if (opts.forNewDocument) {
    if (chars(title) < 3) return bad("Give the drawing or document a title (at least 3 characters).", "title");
    if (chars(title) > 160) return bad("Keep the title under 160 characters.", "title");
  }
  const number = oneLine(i.number);
  if (chars(number) > 40) return bad("Keep the drawing number under 40 characters.", "number");
  const category = typeof i.category === "string" && (CATEGORIES as readonly string[]).includes(i.category) ? (i.category as DocCategory) : null;
  if (opts.forNewDocument && !category) return bad("Choose a category.", "category");
  const description = cleanText(i.description);
  if (chars(description) > 1000) return bad("Keep the description under 1000 characters.", "description");
  const revision = parseRevisionLabel(i.revision);
  if (!revision.ok) return revision;
  const note = cleanText(i.note);
  if (chars(note) > 500) return bad("Keep the note about what changed under 500 characters.", "note");
  const issuedOn = i.issuedOn === undefined || i.issuedOn === "" ? today : i.issuedOn;
  if (!isYmd(issuedOn) || issuedOn < "2000-01-01") return bad("Choose a valid issue date.", "issuedOn");
  if (issuedOn > today) return bad("The issue date cannot be in the future.", "issuedOn");
  return { ok: true, value: { title, number: number ? number.toUpperCase() : null, category: category ?? "OTHER", description: description || null, revision: revision.value, note: note || null, issuedOn } };
}

/** The label that usually comes next: A -> B, R2 -> R3, 01 -> 02, 0 -> 1. A suggestion only. */
export function nextRevisionLabel(current: string | null | undefined): string {
  if (!current) return "A";
  const v = current.trim().toUpperCase();
  if (/^[A-Z]$/.test(v)) return v === "Z" ? "AA" : String.fromCharCode(v.charCodeAt(0) + 1);
  const m = /^(.*?)(\d+)$/.exec(v);
  if (m) return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, "0")}`;
  return `${v}-2`;
}

export type RevisionLike = { id: string; revision: string; createdAt: Date | string };

/** The revision to build from: the one added last. */
export function currentRevision<T extends RevisionLike>(revisions: T[]): T | null {
  return [...revisions].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
