import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { dbFor } from "@/lib/org/scoped-db";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { requireUser } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> };

function contentTypeFromName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

function detectContentType(filename: string, buffer?: Buffer) {
  if (buffer && buffer.length >= 4) {
    if (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    ) {
      return "application/pdf";
    }
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return "image/png";
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }
  }
  return contentTypeFromName(filename);
}

export async function GET(_req: Request, context: RouteContext) {
  const requestId = newRequestId();
  const { id } = await context.params;

  let orgId: string | undefined;
  try {
    const user = await requireUser();
    orgId = user.orgId;

    const invoice = await dbFor(user.orgId).invoice.findFirst({
      where: {
        id,
        ...invoiceAccessWhere(user),
      },
      select: { id: true, fileUrl: true, invoiceNumber: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const fileUrl = invoice.fileUrl;

    if (fileUrl.startsWith("local://")) {
      const relative = fileUrl.replace(/^local:\/\//, "");
      const absolute = path.resolve(process.cwd(), relative);
      const uploadsRoot = path.resolve(process.cwd(), ".data", "uploads");
      if (!absolute.startsWith(uploadsRoot)) {
        return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
      }
      try {
        const buffer = await readFile(absolute);
        const filename = path.basename(absolute);
        const contentType = detectContentType(filename, buffer);
        return new NextResponse(buffer, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${filename}"`,
            "Cache-Control": "private, max-age=60",
          },
        });
      } catch {
        return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
      }
    }

    if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
      try {
        const upstream = await fetch(fileUrl);
        if (!upstream.ok || !upstream.body) {
          return NextResponse.redirect(fileUrl);
        }
        const contentType =
          upstream.headers.get("content-type") ??
          contentTypeFromName(fileUrl);
        return new NextResponse(upstream.body, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="invoice-${invoice.invoiceNumber}"`,
            "Cache-Control": "private, max-age=60",
          },
        });
      } catch {
        return NextResponse.redirect(fileUrl);
      }
    }

    return NextResponse.json({ error: "Unsupported file URL" }, { status: 400 });
  } catch (error) {
    const appError = await handleError({
      error,
      endpoint: `/api/invoices/${id}/file`,
      method: "GET",
      requestId,
      organizationId: orgId,
    });
    const status = isAppError(error) ? appError.status : 500;
    return NextResponse.json(
      { error: appError.message, code: appError.code, requestId },
      { status }
    );
  }
}
