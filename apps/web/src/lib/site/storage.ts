import { readFile } from "fs/promises";
import path from "path";
import { deleteInvoiceFiles, uploadInvoiceFile } from "@/lib/azure/blob";
import { checkPhoto, EXTENSION } from "@/lib/site/rules";
import { checkDocumentFile, safeFileName, type DocFormat } from "@/lib/site/document-rules";

/** Stores one site photo after checking what it really is. Returns where it was kept and its true type. */
export async function storePhoto(prefix: string, bytes: Buffer): Promise<{ ok: true; fileUrl: string; contentType: string; sizeBytes: number } | { ok: false; error: string }> {
  const check = checkPhoto(bytes.subarray(0, 16), bytes.length);
  if (!check.ok) return check;
  const fileUrl = await uploadInvoiceFile(`site-${prefix}.${EXTENSION[check.contentType]}`, bytes, check.contentType);
  return { ok: true, fileUrl, contentType: check.contentType, sizeBytes: bytes.length };
}

/** Stores one drawing or document after checking what it really is (bytes and name together). */
export async function storeDocument(prefix: string, bytes: Buffer, fileName: string): Promise<{ ok: true; fileUrl: string; format: DocFormat; fileName: string; sizeBytes: number } | { ok: false; error: string }> {
  const check = checkDocumentFile(bytes.subarray(0, 8192), bytes.length, fileName);
  if (!check.ok) return check;
  const name = safeFileName(fileName);
  const fileUrl = await uploadInvoiceFile(`doc-${prefix}-${name}`, bytes, check.format.contentType);
  return { ok: true, fileUrl, format: check.format, fileName: name, sizeBytes: bytes.length };
}

/** Reads a stored photo back (kept on disk in development, in blob storage otherwise). */
export async function readPhoto(fileUrl: string): Promise<Buffer | null> {
  try {
    if (fileUrl.startsWith("local://")) {
      const absolute = path.resolve(process.cwd(), fileUrl.replace(/^local:\/\//, ""));
      const root = path.resolve(process.cwd(), ".data", "uploads");
      if (!absolute.startsWith(root + path.sep)) return null;
      return await readFile(absolute);
    }
    if (fileUrl.startsWith("https://") || fileUrl.startsWith("http://")) {
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
  } catch {
    // fall through
  }
  return null;
}

export async function removePhotos(fileUrls: string[]) {
  if (fileUrls.length > 0) await deleteInvoiceFiles(fileUrls).catch(() => undefined);
}
