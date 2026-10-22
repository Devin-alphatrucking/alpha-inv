import { NextResponse } from "next/server";
import { processInvoiceUpload } from "@/lib/invoices/process-upload";
import { requireUser } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = newRequestId();
  const endpoint = "/api/invoices/upload";
  const method = "POST";

  let orgId: string | undefined;
  try {
    const user = await requireUser();
    orgId = user.orgId;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const categoryIdRaw = formData.get("categoryId");
    const categoryId =
      typeof categoryIdRaw === "string" && categoryIdRaw.trim()
        ? categoryIdRaw.trim()
        : null;

    if (!categoryId) {
      return NextResponse.json(
        { error: "Please select a category before extracting." },
        { status: 400 }
      );
    }

    const projectIdRaw = formData.get("projectId");
    const projectId =
      typeof projectIdRaw === "string" && projectIdRaw.trim()
        ? projectIdRaw.trim()
        : null;
    if (!projectId) {
      return NextResponse.json(
        { error: "Please select a project before extracting." },
        { status: 400 }
      );
    }

    const result = await processInvoiceUpload({
      file,
      orgId: user.orgId,
      userId: user.id,
      role: user.role,
      projectId,
      categoryId,
    });

    await logActivity({
      userId: user.id,
      organizationId: user.orgId,
      action: "INVOICE_UPLOADED",
      module: "INVOICE",
      entityId: result.invoiceId,
      details: { duplicateWarning: result.duplicateWarning },
    });

    return NextResponse.json({
      invoiceId: result.invoiceId,
      reviewUrl: `/invoices/${result.invoiceId}/review`,
      duplicateWarning: result.duplicateWarning,
      originalInvoiceNumber: result.originalInvoiceNumber,
    });
  } catch (error) {
    const appError = await handleError({
      error,
      endpoint,
      method,
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
