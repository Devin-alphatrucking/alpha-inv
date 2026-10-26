export const REQUEST_NAME: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Waiting for approval", APPROVED: "Approved", REJECTED: "Rejected", ORDERED: "Ordered", CANCELLED: "Cancelled" };
export const requestTone = (s: string) => (s === "APPROVED" || s === "ORDERED" ? "ok" : s === "REJECTED" ? "danger" : s === "SUBMITTED" ? "warn" : "neutral") as "ok" | "danger" | "warn" | "neutral";
export const PROGRESS_NAME: Record<string, string> = { NOT_RECEIVED: "Nothing received", PARTLY: "Part received", RECEIVED: "Fully received" };
