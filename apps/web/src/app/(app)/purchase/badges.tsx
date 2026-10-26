import { Badge } from "@/components/ui/badge";
import { ORDER_LABEL, REQUEST_LABEL, type OrderState, type RequestState } from "@/lib/purchase/rules";

export function RequestBadge({ status }: { status: RequestState }) {
  const variant = status === "APPROVED" || status === "ORDERED" ? "default" : status === "REJECTED" ? "destructive" : status === "SUBMITTED" ? "secondary" : "outline";
  return <Badge variant={variant}>{REQUEST_LABEL[status]}</Badge>;
}

export function OrderBadge({ status }: { status: OrderState }) {
  return <Badge variant={status === "SENT" ? "default" : status === "CANCELLED" ? "destructive" : "secondary"}>{ORDER_LABEL[status]}</Badge>;
}
