export const CATEGORY_NAME: Record<string, string> = {
  ARCHITECTURAL: "Architectural", STRUCTURAL: "Structural", MEP: "MEP (services)", SITE_PLAN: "Site plan", SPECIFICATION: "Specification", CONTRACT: "Contract", OTHER: "Other",
};
export const CATEGORY_CHOICES = [{ id: "", name: "All" }, ...Object.entries(CATEGORY_NAME).map(([id, name]) => ({ id, name }))];

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
