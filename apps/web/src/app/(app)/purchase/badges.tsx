import { Badge } from "@/components/ui/badge";
import { ORDER_LABEL, REQUEST_LABEL, type OrderState, type RequestState } from "@/lib/purchase/rules";

export function RequestBadge({ status }: { status: RequestState }) {
  const variant = status === "APPROVED" || status === "ORDERED" ? "default" : status === "REJECTED" ? "destructive" : status === "SUBMITTED" ? "secondary" : "outline";
  return <Badge variant={variant}>{REQUEST_LABEL[status]}</Badge>;
}

export function OrderBadge({ status }: { status: OrderState }) {
  const variant = status === "DELIVERED" || status === "CLOSED" ? "default" : status === "CANCELLED" ? "destructive" : status === "DRAFT" ? "outline" : "secondary";
  return <Badge variant={variant}>{ORDER_LABEL[status]}</Badge>;
}
