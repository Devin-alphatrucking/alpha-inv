import {
  DocumentAnalysisClient,
  AzureKeyCredential,
  type AnalyzeResult,
  type AnalyzedDocument,
} from "@azure/ai-form-recognizer";

export type AzureCredentials = { endpoint: string; key: string };

// One client per distinct endpoint+key (each project can have its own).
const clients = new Map<string, DocumentAnalysisClient>();

function envCredentials(): Partial<AzureCredentials> {
  return {
    endpoint: process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim(),
    key: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim(),
  };
}

export function isValidEndpointUrl(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Env-level credentials, used when a project has none of its own. */
export function getEnvCredentials(): AzureCredentials | null {
  const { endpoint, key } = envCredentials();
  if (endpoint && key && isValidEndpointUrl(endpoint)) return { endpoint, key };
  return null;
}

function getClient(credentials?: AzureCredentials) {
  const creds = credentials ?? getEnvCredentials();
  if (!creds) {
    throw new Error(
      "Azure Document Intelligence is not configured. Add an endpoint and key to the project (or AZURE_DOCUMENT_INTELLIGENCE_* in .env)."
    );
  }
  if (!isValidEndpointUrl(creds.endpoint)) {
    throw new Error(
      `Azure endpoint must be a full URL (e.g. https://<resource>.cognitiveservices.azure.com/), got "${creds.endpoint.slice(0, 32)}…".`
    );
  }
  const cacheKey = `${creds.endpoint}|${creds.key}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new DocumentAnalysisClient(
      creds.endpoint,
      new AzureKeyCredential(creds.key)
    );
    clients.set(cacheKey, client);
  }
  return client;
}

export function isDocumentIntelligenceConfigured() {
  return getEnvCredentials() !== null;
}

export type ExtractedInvoiceLineItem = {
  description: string;
  productCode?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  confidence: number;
};

export type ExtractedInvoice = {
  vendorName?: string;
  vendorGstin?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  subtotal?: number;
  totalTax?: number;
  invoiceTotal?: number;
  lineItems: ExtractedInvoiceLineItem[];
  /** Pages Azure actually analysed (what it bills for). */
  pageCount: number;
  raw: AnalyzeResult<AnalyzedDocument>;
};

/**
 * Azure currency fields often come back as `{ amount, currencyCode }` objects,
 * not plain numbers. Normalize anything we get into a finite number or undefined.
 */
function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("amount" in obj) return toNumber(obj.amount);
    if ("value" in obj) return toNumber(obj.value);
  }
  return undefined;
}

function fieldValue(fields: Record<string, unknown>, name: string): unknown {
  const field = fields[name] as { value?: unknown } | undefined;
  return field && "value" in field ? field.value : undefined;
}

/**
 * Runs the prebuilt-invoice model against an uploaded invoice file and
 * returns a normalized shape ready to prefill the review screen.
 */
export async function extractInvoice(
  fileBuffer: Buffer,
  credentials?: AzureCredentials
): Promise<ExtractedInvoice> {
  const client = getClient(credentials);
  const poller = await client.beginAnalyzeDocument(
    "prebuilt-invoice",
    fileBuffer
  );
  const result = await poller.pollUntilDone();

  const document = result.documents?.[0];
  const fields = (document?.fields ?? {}) as Record<string, unknown>;

  const getString = (name: string) => {
    const value = fieldValue(fields, name);
    return typeof value === "string" ? value : undefined;
  };

  const getNumber = (name: string) => toNumber(fieldValue(fields, name));

  const getDate = (name: string) => {
    const value = fieldValue(fields, name);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    return undefined;
  };

  const itemsField = fields["Items"] as
    | { values?: Array<{ properties?: Record<string, { value?: unknown }>; confidence?: number }> }
    | undefined;

  const lineItems: ExtractedInvoiceLineItem[] = Array.isArray(itemsField?.values)
    ? itemsField.values.map((item) => {
        const props = item?.properties ?? {};
        return {
          description: String(props["Description"]?.value ?? "").trim().toUpperCase(),
          productCode:
            typeof props["ProductCode"]?.value === "string"
              ? props["ProductCode"].value.trim().toUpperCase()
              : undefined,
          quantity: toNumber(props["Quantity"]?.value),
          unit:
            typeof props["Unit"]?.value === "string"
              ? props["Unit"].value.trim().toUpperCase()
              : undefined,
          unitPrice: toNumber(props["UnitPrice"]?.value),
          amount: toNumber(props["Amount"]?.value),
          confidence: item?.confidence ?? 0,
        };
      })
    : [];

  return {
    vendorName: getString("VendorName")?.trim().toUpperCase(),
    vendorGstin: getString("VendorTaxId")?.trim().toUpperCase(),
    invoiceNumber: getString("InvoiceId")?.trim().toUpperCase(),
    invoiceDate: getDate("InvoiceDate"),
    dueDate: getDate("DueDate"),
    subtotal: getNumber("SubTotal"),
    totalTax: getNumber("TotalTax"),
    invoiceTotal: getNumber("InvoiceTotal"),
    lineItems,
    pageCount: result.pages?.length ?? 0,
    raw: result,
  };
}
