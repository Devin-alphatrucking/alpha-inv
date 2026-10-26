import { checkGstin, hasValue } from "@/lib/gst/gstin";

/**
 * A small flag beside a saved GSTIN: red "Check GSTIN" (with the reason on hover and for screen readers) when it is not a valid
 * number, the state name in grey when it is. Nothing when there is no GSTIN. It cannot tell whether the number is registered.
 */
export function GstinFlag({ gstin }: { gstin: string | null | undefined }) {
  if (!hasValue(gstin)) return null;
  const check = checkGstin(gstin);
  if (check.ok) return <span className="ml-1.5 text-xs text-muted-foreground">{check.state}</span>;
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600" title={check.reason}>
      Check GSTIN<span className="sr-only">: {check.reason}</span>
    </span>
  );
}
