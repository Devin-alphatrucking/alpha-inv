"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelPurchaseAction, confirmCheckoutAction, startCheckoutAction } from "./actions";

type RazorpaySuccess = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayCtor = new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (r: unknown) => void): void };

function loadCheckoutScript(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("missing")));
    s.onerror = () => reject(new Error("blocked"));
    document.head.appendChild(s);
  });
}

/** Opens Razorpay's checkout for ONE more project plan. The price shown comes from the server. */
export function BuyButton({ priceLabel, brandName }: { priceLabel: string; brandName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  function buy() {
    setMessage(null);
    setFallbackUrl(null);
    start(async () => {
      const started = await startCheckoutAction();
      if (!started.ok) return setMessage({ text: started.error, tone: "error" });
      const c = started.checkout;
      setFallbackUrl(c.shortUrl);
      try {
        const Razorpay = await loadCheckoutScript();
        const box = new Razorpay({
          key: c.keyId,
          subscription_id: c.subscriptionId,
          name: brandName,
          description: `${c.planName} (1 project)`,
          prefill: { name: c.name, email: c.email },
          theme: { color: "#0f172a" },
          handler: async (r: RazorpaySuccess) => {
            const done = await confirmCheckoutAction({ paymentId: r.razorpay_payment_id, subscriptionId: r.razorpay_subscription_id, signature: r.razorpay_signature });
            setMessage(done.ok ? { text: "Payment received. Your new project plan is being added.", tone: "ok" } : { text: done.error, tone: "error" });
            router.refresh();
          },
        });
        box.open();
      } catch {
        setMessage({ text: "The payment window could not be opened. Use the payment page link below instead.", tone: "error" });
      }
    });
  }

  return (
    <div className="grid gap-2">
      <div>
        <Button onClick={buy} disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Add a project plan ({priceLabel})
        </Button>
      </div>
      {message && <p className={message.tone === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{message.text}</p>}
      {fallbackUrl && (
        <a className="text-sm underline" href={fallbackUrl} target="_blank" rel="noreferrer">
          Open the payment page instead
        </a>
      )}
    </div>
  );
}

export function CancelPlanButton({ purchaseId, running }: { purchaseId: string; running: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ask = useConfirm();

  async function cancel() {
    const text = running
      ? "Stop this project plan at the end of the period you have paid for? You keep it until then and nothing is deleted."
      : "Cancel this project plan?";
    if (!(await ask({ title: running ? "Stop this plan at the end of the period?" : "Cancel this plan?", description: text, confirmLabel: running ? "Stop the plan" : "Cancel the plan", cancelLabel: "Keep it", variant: "destructive" }))) return;
    setError(null);
    start(async () => {
      const r = await cancelPurchaseAction(purchaseId);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={cancel} disabled={pending}>
        {pending && <Loader2 className="mr-2 size-3 animate-spin" />}
        {running ? "Stop at period end" : "Cancel"}
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
