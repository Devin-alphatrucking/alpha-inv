import { useState } from "react";
import { Text, View } from "react-native";
import { ApiError, type PaymentRow } from "@/lib/client";
import { day, money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Card, Chips, Field, Muted } from "@/components/ui";

const MODES = ["UPI", "NEFT", "RTGS", "Cash", "Cheque"].map((m) => ({ id: m, name: m }));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** What was paid on an invoice, and (for people who may) a short form to record the next payment. The amount starts as the whole balance. */
export function PaymentCard({ invoiceId, payments, paid, balance, canPay, onSaved }: { invoiceId: string; payments: PaymentRow[]; paid: string; balance: string; canPay: boolean; onSaved: () => void }) {
  const t = useTheme();
  const { client, me } = useSession();
  const fmt = me?.company.brand?.format;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance);
  const [paidOn, setPaidOn] = useState(isoDay(new Date()));
  const [mode, setMode] = useState("UPI");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Enter the amount paid.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return setError("Write the date as YYYY-MM-DD, for example 2026-11-02.");
    setBusy(true);
    setError(null);
    try {
      await client.recordPayment(invoiceId, { amount: n, paidOn, mode, reference: reference.trim() || undefined });
      setOpen(false);
      setReference("");
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record the payment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: t.text }}>Payments</Text>
        <Muted>Paid {money(paid, fmt)} · Balance {money(balance, fmt)}</Muted>
      </View>
      {payments.length === 0 ? <Muted>No payment recorded yet.</Muted> : null}
      {payments.map((p) => (
        <View key={p.id} style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.border, paddingTop: space.sm }}>
          <Muted>{day(p.paidOn, fmt)}{p.mode ? ` · ${p.mode}` : ""}{p.reference ? ` · ${p.reference}` : ""}</Muted>
          <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>{money(p.amount, fmt)}</Text>
        </View>
      ))}
      {canPay && !open ? <Button label="Record a payment" variant="outline" onPress={() => { setAmount(balance); setOpen(true); }} /> : null}
      {canPay && open ? (
        <View style={{ gap: space.md, borderTopWidth: 1, borderTopColor: t.border, paddingTop: space.md }}>
          <Field label="Amount paid" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Paid on (YYYY-MM-DD)" value={paidOn} onChangeText={setPaidOn} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" />
          <Chips label="How it was paid" options={MODES} value={mode} onChange={setMode} />
          <Field label="Reference (UTR, cheque number)" value={reference} onChangeText={setReference} autoCapitalize="characters" error={error} />
          <Button label="Save payment" onPress={save} busy={busy} />
          <Button label="Cancel" variant="outline" onPress={() => { setOpen(false); setError(null); }} />
        </View>
      ) : null}
    </Card>
  );
}
