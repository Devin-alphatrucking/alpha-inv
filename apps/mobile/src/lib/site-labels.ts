export const STATUS_NAME: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", FIXED: "Fixed", CLOSED: "Closed" };
export const SEVERITY_NAME: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
export const severityTone = (s: string) => (s === "HIGH" ? "danger" : s === "MEDIUM" ? "warn" : "neutral") as "danger" | "warn" | "neutral";
