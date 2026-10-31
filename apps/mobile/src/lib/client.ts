// API client for the Sanvicasa mobile apps. No React Native imports here, so the same code is tested in Node
// against the real server (scripts/test-client.ts). It keeps the access token in memory, the refresh token in
// the injected secure storage, refreshes on a 401 (one refresh at a time, however many calls are waiting) and
// signs the person out when the server says the session is over.

export type Tokens = { accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string };

export type SecureStore = {
  get(): Promise<string | null>;
  set(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Brand = {
  name: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  format: { currency: string; locale: string; timeZone: string } & Record<string, unknown>;
};

export type PlanSummary = {
  name: string | null;
  state: "trial" | "active" | "past_due_grace" | "past_due" | "canceling" | "canceled" | "trial_expired" | "none";
  message: string | null;
  quantity: number;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  limits: { projects: number; users: number; aiPagesPerProject: number; companyPageCap: number };
  usage: { projects: number; users: number; pendingInvites: number };
};

export type Me = {
  user: { id: string; name: string; email: string; role: string };
  /** What this role may do (the server checks again on every request). */
  permissions: string[];
  company: { id: string; brand: Brand | null };
  companies: { id: string; name: string; role: string }[];
  plan: PlanSummary;
};

export type InvoiceStatus = "PROCESSING" | "NEEDS_REVIEW" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  total: string;
  status: InvoiceStatus;
  paidAt: string | null;
  createdAt: string;
  vendor: { id: string; name: string };
  project: { id: string; name: string };
};

export type InvoiceDetail = InvoiceRow & {
  deliveryDate: string | null;
  subtotal: string;
  sgst: string;
  cgst: string;
  igst: string;
  rounding: string;
  paymentTerms: string | null;
  pageCount: number | null;
  vendor: { id: string; name: string; gstin: string | null };
  category: { id: string; name: string } | null;
  lineItems: { id: string; description: string; hsnCode: string | null; quantity: string; unit: string; rateExclGst: string; gstPercent: string; gstAmount: string; lineTotal: string }[];
};

export type PaymentRow = { id: string; amount: string; paidOn: string; mode: string | null; reference: string | null; notes?: string | null };
export type InvoiceDetailResponse = { invoice: InvoiceDetail & { payments: PaymentRow[] }; paid: string; balance: string; canPay: boolean; fileUrl: string };
export type PaymentInput = { amount: number; paidOn: string; mode?: string; reference?: string; notes?: string };
export type PaymentsList = {
  totals: { paid: string; paidThisMonth: string; outstanding: string };
  payments: (PaymentRow & { invoice: { id: string; invoiceNumber: string; vendor: { name: string }; project: { name: string } } })[];
};
export type VendorRow = { id: string; name: string; gstin: string | null; invoiceCount: number };
export type VendorDetail = {
  vendor: { id: string; name: string; gstin: string | null };
  totals: { billed: string; paid: string; owed: string };
  invoices: { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null; total: string; status: InvoiceStatus; project: { name: string } }[];
};

export type SignUpInput = { companyName: string; name: string; email: string; phone: string; password: string; country: string; acceptTerms: boolean };

export type UploadResult = { invoiceId: string; duplicateWarning?: boolean; originalInvoiceNumber?: string | null };


// ---- Site work, material requests and deliveries

export type ProjectOverview = { id: string; name: string; todayReport: "DRAFT" | "SUBMITTED" | null; openIssues: number; overdueIssues: number };
export type SiteOverview = { today: string; projects: ProjectOverview[] };

export type ReportView = {
  id: string; projectId: string; reportDate: string; weather: string | null; workDone: string; labourCount: number | null; machinery: string | null; materialsUsed: string | null;
  problems: string | null; safetyNote: string | null; status: "DRAFT" | "SUBMITTED"; authorName: string | null; submittedByName: string | null; canEdit: boolean; canSubmit: boolean; canReopen: boolean;
};
export type ReportInput = { projectId: string; reportDate: string; weather?: string; workDone: string; labourCount?: string; machinery?: string; materialsUsed?: string; problems?: string; safetyNote?: string };

export type PhotoView = { id: string; projectId: string; projectName: string; takenOn: string; caption: string | null; area: string | null; uploaderName: string | null; canDelete: boolean };

export type IssueState = "OPEN" | "IN_PROGRESS" | "FIXED" | "CLOSED";
export type IssueView = {
  id: string; projectId: string; projectName: string; title: string; description: string | null; area: string | null; severity: "LOW" | "MEDIUM" | "HIGH"; status: IssueState;
  assigneeId: string | null; assigneeName: string | null; raisedByName: string | null; dueDate: string | null; photoCount: number; canEdit: boolean; next: IssueState[];
};
export type IssueCounts = { open: number; inProgress: number; fixed: number; closed: number; stillOpenHigh: number; overdue: number };
export type IssueInput = { projectId: string; title: string; description?: string; area?: string; severity: "LOW" | "MEDIUM" | "HIGH"; dueDate?: string; assigneeId?: string; /** Makes a retry safe: the server keeps the first record made with it. */ clientRef?: string };

export type RequestState = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "ORDERED" | "CANCELLED";
export type RequestAction = "edit" | "submit" | "withdraw" | "approve" | "reject" | "cancel" | "order";
export type RequestView = {
  id: string; number: string; projectId: string; projectName: string; status: RequestState; neededBy: string | null; note: string | null; requestedByName: string | null;
  decidedByName: string | null; decisionNote: string | null; lines: { id: string; description: string; unit: string; quantity: string }[]; actions: RequestAction[];
};
export type RequestInput = { projectId: string; neededBy?: string; note?: string; lines: { description: string; unit: string; quantity: string }[]; submit?: boolean; clientRef?: string };

export type DeliveryRow = { orderId: string; number: string; vendorName: string; projectName: string; deliveryDate: string | null; progress: "NOT_RECEIVED" | "PARTLY" | "RECEIVED"; late: boolean };
export type DeliveryView = {
  orderId: string; number: string; status: "DRAFT" | "SENT" | "PART_DELIVERED" | "DELIVERED" | "CLOSED" | "CANCELLED"; vendorName: string; projectId: string; projectName: string; deliveryDate: string | null;
  lines: { id: string; description: string; unit: string; ordered: string; received: string; rejected: string; remaining: string; progress: "NONE" | "PARTLY" | "FULL" | "OVER" }[];
  progress: "NOT_RECEIVED" | "PARTLY" | "RECEIVED"; canRecord: boolean;
  receipts: { id: string; receivedOn: string; challanNo: string | null; note: string | null; receivedByName: string | null; photoCount: number; canDelete: boolean; lines: { description: string; unit: string; quantity: string; rejected: string; remark: string | null }[] }[];
};
export type ReceiptInput = { receivedOn?: string; challanNo?: string; note?: string; lines: { orderLineId: string; quantity: string; rejected?: string; remark?: string }[]; clientRef?: string };

export type DocumentRevision = { id: string; revision: string; note: string | null; issuedOn: string; fileName: string; formatLabel: string; opensInPage: boolean; sizeBytes: number; uploadedByName: string | null; isCurrent: boolean };
export type DocumentView = {
  id: string; projectId: string; projectName: string; title: string; number: string | null; category: string; description: string | null;
  current: DocumentRevision | null; revisionCount: number; revisions: DocumentRevision[];
};

export type PhotoTarget = { projectId: string; reportId?: string; issueId?: string; receiptId?: string; area?: string; caption?: string; clientRef?: string };
export type PhotoUploadResult = { ok: true; added: number; skipped: string[] };

export type ClientOptions = {
  baseUrl: string;
  store: SecureStore;
  fetch?: typeof fetch;
  /** Called when the session is over (revoked, expired, signed out elsewhere). The app shows the login screen. */
  onSignedOut?: () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type FileInput = { uri: string; name: string; type: string };

export function createClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let access: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<boolean> | null = null;

  async function parse(res: Response) {
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return body as Record<string, unknown> | null;
  }

  function toError(res: Response, body: Record<string, unknown> | null) {
    const message = typeof body?.error === "string" ? body.error : res.status >= 500 ? "The server had a problem. Please try again." : "Something went wrong.";
    return new ApiError(res.status, typeof body?.code === "string" ? body.code : "error", message);
  }

  async function saveTokens(t: Tokens) {
    access = { token: t.accessToken, expiresAt: new Date(t.accessExpiresAt).getTime() };
    await opts.store.set(t.refreshToken);
  }

  async function endSession() {
    access = null;
    await opts.store.clear();
    opts.onSignedOut?.();
  }

  /** One refresh at a time: every caller waiting for a token shares the same attempt. Returns false when the session is over. */
  function refresh(): Promise<boolean> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const refreshToken = await opts.store.get();
          if (!refreshToken) {
            await endSession();
            return false;
          }
          let res: Response;
          try {
            res = await f(`${base}/api/v1/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
          } catch {
            throw new ApiError(0, "network", "No connection. Check your internet and try again.");
          }
          const body = await parse(res);
          if (res.ok && body?.tokens) {
            await saveTokens(body.tokens as Tokens);
            return true;
          }
          // Another refresh from this device won the race a moment ago: wait, then read the token it saved.
          if (res.status === 409) {
            await sleep(700 * (attempt + 1));
            continue;
          }
          if (res.status === 401 || res.status === 403) {
            await endSession();
            return false;
          }
          throw toError(res, body); // 429, 5xx: the session may be fine, so keep the tokens
        }
        throw new ApiError(409, "refresh_in_progress", "Please try again.");
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function token(): Promise<string | null> {
    // Refresh a little early, so a request is not sent with a token that expires on the way.
    if (access && access.expiresAt - now() > 30_000) return access.token;
    if (!(await opts.store.get())) return null;
    return (await refresh()) && access ? access.token : null;
  }

  async function request<T>(path: string, init: { method?: string; json?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
    const auth = init.auth !== false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = {};
      if (init.json !== undefined) headers["Content-Type"] = "application/json";
      if (auth) {
        const t = await token();
        if (!t) throw new ApiError(401, "unauthenticated", "Please sign in again.");
        headers.Authorization = `Bearer ${t}`;
      }
      let res: Response;
      try {
        res = await f(`${base}${path}`, { method: init.method ?? (init.json || init.form ? "POST" : "GET"), headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) });
      } catch {
        throw new ApiError(0, "network", "No connection. Check your internet and try again.");
      }
      if (res.status === 401 && auth && attempt === 0) {
        access = null; // rejected: it may have been revoked or expired early; try one refresh
        if (await refresh()) continue;
        throw new ApiError(401, "session_ended", "Please sign in again.");
      }
      const body = await parse(res);
      if (!res.ok) throw toError(res, body);
      return body as T;
    }
    throw new ApiError(401, "session_ended", "Please sign in again.");
  }

  return {
    /** True when a refresh token is saved (the app opens straight to its screens and confirms with /me). */
    hasSession: async () => (await opts.store.get()) !== null,

    async signIn(email: string, password: string, device: { deviceName?: string; platform?: "ios" | "android"; appVersion?: string; totp?: string } = {}) {
      const body = await request<{ tokens: Tokens }>("/api/v1/auth/login", { json: { email: email.trim(), password, ...device }, auth: false });
      await saveTokens(body.tokens);
    },

    async signOut() {
      try {
        if (access || (await opts.store.get())) await request("/api/v1/auth/logout", { method: "POST", json: {} });
      } catch {
        /* offline or already ended: the local sign-out below is what matters */
      }
      access = null;
      await opts.store.clear();
    },

    /** Sign in with a Google ID token from the phone's Google sign-in. Creates a company on a free trial for a brand new person. */
    async signInWithGoogle(idToken: string, device: { deviceName?: string; platform?: "ios" | "android"; appVersion?: string } = {}) {
      const body = await request<{ tokens: Tokens; created: boolean }>("/api/v1/auth/google", { json: { idToken, ...device }, auth: false });
      await saveTokens(body.tokens);
      return { created: body.created };
    },

    // ---- Sign-up and password help (no sign-in needed)
    signUp: (input: SignUpInput) => request<{ checkEmail: true }>("/api/v1/auth/signup", { json: input, auth: false }),
    confirmEmail: (email: string, code: string) => request<{ ok: true }>("/api/v1/auth/confirm", { json: { email: email.trim(), code: code.trim() }, auth: false }),
    resendCode: (email: string) => request<{ message: string }>("/api/v1/auth/resend", { json: { email: email.trim() }, auth: false }),
    forgotPassword: (email: string) => request<{ message: string }>("/api/v1/auth/forgot", { json: { email: email.trim() }, auth: false }),
    resetPassword: (input: { email: string; code: string; password: string }) => request<{ ok: true }>("/api/v1/auth/reset", { json: { ...input, email: input.email.trim(), code: input.code.trim() }, auth: false }),

    me: () => request<Me>("/api/v1/me"),
    switchCompany: (companyId: string) => request<{ companyId: string }>("/api/v1/me/company", { json: { companyId } }),
    projects: () => request<{ projects: { id: string; name: string; status: string; monthlyPageLimit: number }[] }>("/api/v1/projects"),
    categories: () => request<{ categories: { id: string; name: string }[] }>("/api/v1/categories"),

    invoices: (q: { q?: string; status?: string; projectId?: string; page?: number; pageSize?: number } = {}) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") sp.set(k, String(v));
      const s = sp.toString();
      return request<{ page: number; pageSize: number; total: number; items: InvoiceRow[] }>(`/api/v1/invoices${s ? `?${s}` : ""}`);
    },
    invoice: (id: string) => request<InvoiceDetailResponse>(`/api/v1/invoices/${encodeURIComponent(id)}`),
    recordPayment: (invoiceId: string, input: PaymentInput) => request<{ ok: true; paymentId: string; status: InvoiceStatus; paid: string; balance: string }>(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/payments`, { json: input }),
    payments: () => request<PaymentsList>("/api/v1/payments"),
    vendors: (q = "") => request<{ vendors: VendorRow[] }>(`/api/v1/vendors${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`),
    vendor: (id: string) => request<VendorDetail>(`/api/v1/vendors/${encodeURIComponent(id)}`),

    /** Uploads one invoice (photo or PDF). `file` is what the camera, gallery or document picker returned. */
    upload(file: FileInput, projectId: string, categoryId: string) {
      const form = new FormData();
      // React Native sends { uri, name, type } as a file part; Node tests pass a Blob.
      form.append("file", file as unknown as Blob);
      form.append("projectId", projectId);
      form.append("categoryId", categoryId);
      return request<UploadResult>("/api/invoices/upload", { form });
    },


    // ---- Site work
    siteOverview: () => request<SiteOverview>("/api/v1/site/overview"),
    siteReport: (projectId: string, date: string) => request<{ report: ReportView | null; photos: PhotoView[] }>(`/api/v1/site/reports?projectId=${encodeURIComponent(projectId)}&date=${date}`),
    saveSiteReport: (input: ReportInput) => request<{ ok: true; report: ReportView }>("/api/v1/site/reports", { method: "PUT", json: input }),
    submitSiteReport: (id: string) => request<{ ok: true }>(`/api/v1/site/reports/${encodeURIComponent(id)}`, { json: { action: "submit" } }),
    reopenSiteReport: (id: string) => request<{ ok: true }>(`/api/v1/site/reports/${encodeURIComponent(id)}`, { json: { action: "reopen" } }),

    siteIssues: (q: { projectId?: string; status?: string } = {}) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
      const s = sp.toString();
      return request<{ today: string; counts: IssueCounts; issues: IssueView[] }>(`/api/v1/site/issues${s ? `?${s}` : ""}`);
    },
    siteIssue: (id: string) => request<{ issue: IssueView; photos: PhotoView[]; people: { id: string; name: string }[] }>(`/api/v1/site/issues/${encodeURIComponent(id)}`),
    raiseIssue: (input: IssueInput) => request<{ ok: true; id: string }>("/api/v1/site/issues", { json: input }),
    setIssueStatus: (id: string, status: IssueState) => request<{ ok: true }>(`/api/v1/site/issues/${encodeURIComponent(id)}`, { json: { status } }),
    sitePeople: (projectId: string) => request<{ people: { id: string; name: string }[] }>(`/api/v1/site/people?projectId=${encodeURIComponent(projectId)}`),

    sitePhotos: (q: { projectId?: string; reportId?: string; issueId?: string; receiptId?: string }) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
      return request<{ photos: PhotoView[] }>(`/api/v1/site/photos?${sp.toString()}`);
    },
    /** Adds photos (camera or gallery) to a project, a day's report, an issue or a delivery. Up to 10 at a time. */
    uploadSitePhotos(files: FileInput[], target: PhotoTarget) {
      const form = new FormData();
      for (const [k, v] of Object.entries(target)) if (v) form.append(k, v);
      for (const file of files) form.append("file", file as unknown as Blob);
      return request<PhotoUploadResult>("/api/v1/site/photos", { form });
    },
    deleteSitePhoto: (id: string) => request<{ ok: true }>(`/api/v1/site/photos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Address and sign-in header to show one site photo. */
    async photoSource(id: string) {
      const t = await token();
      if (!t) throw new ApiError(401, "unauthenticated", "Please sign in again.");
      return { uri: `${base}/api/v1/site/photos/${encodeURIComponent(id)}`, headers: { Authorization: `Bearer ${t}` } };
    },

    // ---- Drawings and documents (read only on the phone)
    documents: (q: { projectId?: string; category?: string; q?: string } = {}) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
      const s = sp.toString();
      return request<{ documents: DocumentView[] }>(`/api/v1/site/documents${s ? `?${s}` : ""}`);
    },
    document: (id: string) => request<{ document: DocumentView }>(`/api/v1/site/documents/${encodeURIComponent(id)}`),
    /** A five-minute address that opens one revision in the phone's browser (the browser cannot send the sign-in header). */
    documentLink: (revisionId: string) => request<{ url: string; expiresInSeconds: number }>(`/api/v1/site/documents/revisions/${encodeURIComponent(revisionId)}/link`, { method: "POST", json: {} }),

    // ---- Material requests
    requests: (q: { projectId?: string; status?: string } = {}) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
      const s = sp.toString();
      return request<{ requests: RequestView[]; waitingForApproval: number; approvedToOrder: number }>(`/api/v1/purchase/requests${s ? `?${s}` : ""}`);
    },
    purchaseRequest: (id: string) => request<{ request: RequestView }>(`/api/v1/purchase/requests/${encodeURIComponent(id)}`),
    raiseRequest: (input: RequestInput) => request<{ ok: true; id: string; number: string; submitted: boolean; warning?: string }>("/api/v1/purchase/requests", { json: input }),
    changeRequest: (id: string, input: Omit<RequestInput, "projectId" | "submit">) => request<{ ok: true }>(`/api/v1/purchase/requests/${encodeURIComponent(id)}`, { method: "PUT", json: input }),
    actOnRequest: (id: string, action: "submit" | "withdraw" | "cancel" | "approve" | "reject", note?: string) => request<{ ok: true }>(`/api/v1/purchase/requests/${encodeURIComponent(id)}`, { json: { action, note } }),

    // ---- Deliveries (no prices)
    deliveries: (all = false) => request<{ deliveries: DeliveryRow[] }>(`/api/v1/deliveries${all ? "?all=1" : ""}`),
    delivery: (orderId: string) => request<{ delivery: DeliveryView; today: string }>(`/api/v1/deliveries/${encodeURIComponent(orderId)}`),
    recordDelivery: (orderId: string, input: ReceiptInput) => request<{ ok: true; id: string }>(`/api/v1/deliveries/${encodeURIComponent(orderId)}`, { json: input }),
    deleteDelivery: (receiptId: string) => request<{ ok: true }>(`/api/v1/deliveries/receipts/${encodeURIComponent(receiptId)}`, { method: "DELETE" }),

    /** Address and headers to show the original file (image or PDF) with the same sign-in. */
    async fileSource(fileUrl: string) {
      const t = await token();
      if (!t) throw new ApiError(401, "unauthenticated", "Please sign in again.");
      return { uri: `${base}${fileUrl}`, headers: { Authorization: `Bearer ${t}` } };
    },
  };
}

export type ApiClient = ReturnType<typeof createClient>;
