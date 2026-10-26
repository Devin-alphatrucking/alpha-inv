/** Plain names for the roles a person can hold (the server decides what each one may do; the app only shows the name). */
const LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  ACCOUNTANT: "Accountant",
  PURCHASE: "Purchase officer",
  MANAGER: "Project manager",
  ENGINEER: "Site engineer",
  VIEWER: "Viewer",
  STAFF: "General staff",
};

export const roleLabel = (role: string) => LABELS[role] ?? "Staff";
