// Site work rules (daily reports, photos, issues). Pure functions, unit-tested (rules.test.ts).

export const REPORT_MAX = { workDone: 4000, other: 2000, weather: 60 } as const;
export const ISSUE_MAX = { title: 120, description: 2000, area: 120 } as const;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTOS_PER_UPLOAD = 10;
export const WEATHER_CHOICES = ["Clear", "Cloudy", "Light rain", "Heavy rain", "Hot", "Windy", "Fog"] as const;

const UNSAFE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069]", "g");

/** Typed text tidied: uniform line endings, unsafe characters removed, trailing spaces and runs of blank lines dropped. */
export function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n?/g, "\n").replace(UNSAFE, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const isYmd = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };
const bad = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field });
const tooLong = (text: string, max: number) => [...text].length > max;

// ---- daily report

export type ReportInput = { reportDate: string; weather: string | null; workDone: string; labourCount: number | null; machinery: string | null; materialsUsed: string | null; problems: string | null; safetyNote: string | null };

/** Checks a daily report as typed. `today` is the company's calendar day (YYYY-MM-DD): a report cannot be for a day that has not come. */
export function parseReport(raw: unknown, today: string): Result<ReportInput> {
  const i = (raw ?? {}) as Record<string, unknown>;
  if (!isYmd(i.reportDate)) return bad("Choose the date of the report.", "reportDate");
  if (i.reportDate > today) return bad("A report cannot be for a day that has not come yet.", "reportDate");
  if (i.reportDate < "2000-01-01") return bad("Choose a date after the year 2000.", "reportDate");

  const workDone = cleanText(i.workDone);
  if (workDone.length < 3) return bad("Say what work was done today (at least a few words).", "workDone");
  if (tooLong(workDone, REPORT_MAX.workDone)) return bad(`Keep the work done under ${REPORT_MAX.workDone} characters.`, "workDone");

  const optional = (value: unknown, max: number, field: string, label: string): Result<string | null> => {
    const t = cleanText(value);
    if (tooLong(t, max)) return bad(`Keep ${label} under ${max} characters.`, field);
    return { ok: true, value: t === "" ? null : t };
  };
  const weather = optional(i.weather, REPORT_MAX.weather, "weather", "the weather");
  const machinery = optional(i.machinery, REPORT_MAX.other, "machinery", "the machinery note");
  const materialsUsed = optional(i.materialsUsed, REPORT_MAX.other, "materialsUsed", "the materials note");
  const problems = optional(i.problems, REPORT_MAX.other, "problems", "the problems note");
  const safetyNote = optional(i.safetyNote, REPORT_MAX.other, "safetyNote", "the safety note");
  for (const r of [weather, machinery, materialsUsed, problems, safetyNote]) if (!r.ok) return r;

  let labourCount: number | null = null;
  if (i.labourCount !== null && i.labourCount !== undefined && String(i.labourCount).trim() !== "") {
    const n = Number(i.labourCount);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return bad("Enter the number of workers as a whole number, 0 or more.", "labourCount");
    labourCount = n;
  }
  const ok = <T,>(r: Result<T>) => (r.ok ? r.value : (null as T));
  return { ok: true, value: { reportDate: i.reportDate, weather: ok(weather), workDone, labourCount, machinery: ok(machinery), materialsUsed: ok(materialsUsed), problems: ok(problems), safetyNote: ok(safetyNote) } };
}

export type ReportStatus = "DRAFT" | "SUBMITTED";

/** A draft can be edited by anyone who writes site reports; once submitted only a manager can change it (and must reopen it first). */
export function canEditReport(status: ReportStatus, canWrite: boolean, canManage: boolean): boolean {
  if (status === "DRAFT") return canWrite || canManage;
  return canManage;
}

// ---- issues

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ISSUE_STATUSES = ["OPEN", "IN_PROGRESS", "FIXED", "CLOSED"] as const;
export type IssueState = (typeof ISSUE_STATUSES)[number];

export const STATUS_LABEL: Record<IssueState, string> = { OPEN: "Open", IN_PROGRESS: "In progress", FIXED: "Fixed", CLOSED: "Closed" };
export const SEVERITY_LABEL: Record<Severity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export type IssueInput = { title: string; description: string | null; area: string | null; severity: Severity; dueDate: string | null; assigneeId: string | null };

export function parseIssue(raw: unknown): Result<IssueInput> {
  const i = (raw ?? {}) as Record<string, unknown>;
  const title = cleanText(i.title).replace(/\s*\n\s*/g, " ");
  if (title.length < 3) return bad("Give the issue a short title (at least 3 characters).", "title");
  if (tooLong(title, ISSUE_MAX.title)) return bad(`Keep the title under ${ISSUE_MAX.title} characters.`, "title");
  const description = cleanText(i.description);
  if (tooLong(description, ISSUE_MAX.description)) return bad(`Keep the description under ${ISSUE_MAX.description} characters.`, "description");
  const area = cleanText(i.area).replace(/\s*\n\s*/g, " ");
  if (tooLong(area, ISSUE_MAX.area)) return bad(`Keep the area under ${ISSUE_MAX.area} characters.`, "area");
  const severity = typeof i.severity === "string" && (SEVERITIES as readonly string[]).includes(i.severity) ? (i.severity as Severity) : null;
  if (!severity) return bad("Choose how serious it is.", "severity");
  let dueDate: string | null = null;
  if (i.dueDate !== null && i.dueDate !== undefined && String(i.dueDate).trim() !== "") {
    if (!isYmd(i.dueDate) || i.dueDate < "2000-01-01") return bad("Choose a valid due date.", "dueDate");
    dueDate = i.dueDate;
  }
  const assigneeId = typeof i.assigneeId === "string" && i.assigneeId.trim() !== "" ? i.assigneeId.trim() : null;
  return { ok: true, value: { title, description: description || null, area: area || null, severity, dueDate, assigneeId } };
}

/**
 * Where an issue may go next. Anyone who writes site work can start work, mark it fixed, or say a "fixed" one is not.
 * Only a manager closes an issue (accepts the fix) or reopens a closed one.
 */
export function nextStatuses(status: IssueState, canManage: boolean): IssueState[] {
  switch (status) {
    case "OPEN":
      return canManage ? ["IN_PROGRESS", "FIXED", "CLOSED"] : ["IN_PROGRESS", "FIXED"];
    case "IN_PROGRESS":
      return canManage ? ["OPEN", "FIXED", "CLOSED"] : ["OPEN", "FIXED"];
    case "FIXED":
      return canManage ? ["OPEN", "CLOSED"] : ["OPEN"];
    case "CLOSED":
      return canManage ? ["OPEN"] : [];
  }
}

/** Still being worked on and past its due day (a fixed issue waiting for sign-off is not late). */
export function isOverdue(issue: { status: IssueState; dueDate: string | null }, today: string): boolean {
  return issue.dueDate !== null && issue.dueDate < today && (issue.status === "OPEN" || issue.status === "IN_PROGRESS");
}

export type IssueCounts = { open: number; inProgress: number; fixed: number; closed: number; stillOpenHigh: number; overdue: number };

export function summariseIssues(issues: { status: IssueState; severity: Severity; dueDate: string | null }[], today: string): IssueCounts {
  const c: IssueCounts = { open: 0, inProgress: 0, fixed: 0, closed: 0, stillOpenHigh: 0, overdue: 0 };
  for (const i of issues) {
    if (i.status === "OPEN") c.open++;
    else if (i.status === "IN_PROGRESS") c.inProgress++;
    else if (i.status === "FIXED") c.fixed++;
    else c.closed++;
    if ((i.status === "OPEN" || i.status === "IN_PROGRESS") && i.severity === "HIGH") c.stillOpenHigh++;
    if (isOverdue(i, today)) c.overdue++;
  }
  return c;
}

/** Highest severity first, then the soonest due (no due date last), then the newest. */
export function issueOrder<T extends { severity: Severity; dueDate: string | null; createdAt: Date }>(a: T, b: T): number {
  const sev = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return sev[a.severity] - sev[b.severity] || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || b.createdAt.getTime() - a.createdAt.getTime();
}

// ---- photos

export type PhotoCheck = { ok: true; contentType: "image/jpeg" | "image/png" | "image/webp" } | { ok: false; error: string };

/** Decides what a file really is from its first bytes (the name and the type the browser reports can be anything). */
export function checkPhoto(head: Uint8Array, size: number): PhotoCheck {
  if (size <= 0) return { ok: false, error: "The photo is empty." };
  if (size > PHOTO_MAX_BYTES) return { ok: false, error: "A photo must be 8 MB or smaller." };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ok: true, contentType: "image/jpeg" };
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return { ok: true, contentType: "image/png" };
  if (head.length >= 12 && String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP") return { ok: true, contentType: "image/webp" };
  return { ok: false, error: "Only JPEG, PNG or WebP photos can be added." };
}

export const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A caption or area label as typed. */
export function cleanLabel(raw: unknown, max = 160): string | null {
  const t = cleanText(raw).replace(/\s*\n\s*/g, " ");
  return t === "" ? null : [...t].slice(0, max).join("");
}
