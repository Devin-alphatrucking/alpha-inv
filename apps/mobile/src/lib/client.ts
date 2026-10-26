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

export type UploadResult = { invoiceId: string; duplicateWarning?: boolean; originalInvoiceNumber?: string | null };

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
    invoice: (id: string) => request<{ invoice: InvoiceDetail; fileUrl: string }>(`/api/v1/invoices/${encodeURIComponent(id)}`),

    /** Uploads one invoice (photo or PDF). `file` is what the camera, gallery or document picker returned. */
    upload(file: FileInput, projectId: string, categoryId: string) {
      const form = new FormData();
      // React Native sends { uri, name, type } as a file part; Node tests pass a Blob.
      form.append("file", file as unknown as Blob);
      form.append("projectId", projectId);
      form.append("categoryId", categoryId);
      return request<UploadResult>("/api/invoices/upload", { form });
    },

    /** Address and headers to show the original file (image or PDF) with the same sign-in. */
    async fileSource(fileUrl: string) {
      const t = await token();
      if (!t) throw new ApiError(401, "unauthenticated", "Please sign in again.");
      return { uri: `${base}${fileUrl}`, headers: { Authorization: `Bearer ${t}` } };
    },
  };
}

export type ApiClient = ReturnType<typeof createClient>;
