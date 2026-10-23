// The words on the public landing and pricing pages. Every line describes something the product does today.
import type { LucideIcon } from "lucide-react";
import { BellRing, BookOpenCheck, CalendarClock, Camera, FileScan, Gauge, Layers, Palette, Receipt, ShieldCheck, Users, Wallet } from "lucide-react";

export type Feature = { icon: LucideIcon; title: string; text: string };

export const FEATURES: Feature[] = [
  { icon: FileScan, title: "Invoices read for you", text: "Upload a PDF or a photo, or many at once. Supplier, dates, taxes and line items are filled in, then you check and save." },
  { icon: Camera, title: "Made for the site office", text: "Snap an invoice on your phone straight from the delivery. The app works comfortably on a small screen." },
  { icon: CalendarClock, title: "Know what you owe", text: "See what is overdue, what falls due this week, and how old every unpaid bill is. Each supplier has its own statement." },
  { icon: Wallet, title: "Payments that keep status right", text: "Record full or part payments in whatever mode you use: cash, bank transfer, UPI. Paid, part paid and overdue update on their own." },
  { icon: Gauge, title: "Project budgets", text: "Set a budget per project and see spend against it. You are warned at 80% and again at 100%, on screen and by email." },
  { icon: Receipt, title: "GST report in one click", text: "CGST, SGST and IGST by month and by supplier GSTIN, with invoice-level CSV for your accountant. Missing GSTINs are flagged." },
  { icon: BellRing, title: "Rate alerts", text: "When a rate is far above what you usually pay for the same item, you are told before you save the invoice." },
  { icon: BookOpenCheck, title: "A morning email", text: "One short email a day, only when something needs you: overdue bills, bills due soon, invoices waiting for review." },
  { icon: Users, title: "Your whole team, the right access", text: "Administrators see everything. Staff see their own projects. Comments on each invoice keep the conversation with the bill." },
  { icon: Layers, title: "One project per plan", text: "Each plan covers a project with its own team and AI page allowance. Add another plan when you start another project." },
  { icon: Palette, title: "Carries your brand", text: "Your logo, name and colours on the sign-in page and across the app." },
  { icon: ShieldCheck, title: "Your data stays yours", text: "Every company's records are kept apart by the database itself. Two-step sign-in with an authenticator app, and an activity log of who did what." },
];

export const STEPS = [
  { title: "Upload", text: "Drop in invoices as PDFs or photos." },
  { title: "Check", text: "Review what was read, fix anything, and save. Warnings point to what looks off." },
  { title: "Track", text: "Record payments, watch what is due, and download the GST report when it is time to file." },
];

export type Faq = { q: string; a: string };

export function faqs(trialDays: number): Faq[] {
  return [
    { q: "What happens after the free trial?", a: `The trial lasts ${trialDays} days and needs no card. When it ends, your company's data is locked and hidden until you choose a plan. Nothing is deleted: pick a plan and everything is back.` },
    { q: "How does pricing work?", a: "One plan covers one project, with its own team size and monthly AI page allowance, all shown above. Every feature is included. If you run another project, buy another plan for it." },
    { q: "Which files can I upload?", a: "PDF, JPG and PNG, up to 20 MB each, up to 25 at a time. The same file is never read twice, and a repeated invoice number from the same supplier is refused." },
    { q: "Is it built for Indian GST?", a: "Yes. Invoices carry CGST, SGST and IGST, suppliers carry a GSTIN, and the GST report is organised for filing. Amounts follow your company's country settings." },
    { q: "Can I get my data out?", a: "Administrators can download everything as an Excel workbook or JSON backup at any time." },
    { q: "Is my data kept separate from other companies?", a: "Yes. Each company's records are separated inside the database itself, not only in the app, and sign-in can require a code from an authenticator app." },
  ];
}
