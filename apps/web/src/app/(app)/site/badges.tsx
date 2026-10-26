import { Badge } from "@/components/ui/badge";
import { SEVERITY_LABEL, STATUS_LABEL, type IssueState, type Severity } from "@/lib/site/rules";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge variant={severity === "HIGH" ? "destructive" : severity === "MEDIUM" ? "secondary" : "outline"}>{SEVERITY_LABEL[severity]}</Badge>;
}

export function IssueStatusBadge({ status, overdue = false }: { status: IssueState; overdue?: boolean }) {
  if (overdue) return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant={status === "CLOSED" ? "outline" : status === "FIXED" ? "default" : "secondary"}>{STATUS_LABEL[status]}</Badge>;
}

export function ReportStatusBadge({ status }: { status: "DRAFT" | "SUBMITTED" | null }) {
  if (!status) return <Badge variant="outline">Not written</Badge>;
  return <Badge variant={status === "SUBMITTED" ? "default" : "secondary"}>{status === "SUBMITTED" ? "Submitted" : "Draft"}</Badge>;
}
