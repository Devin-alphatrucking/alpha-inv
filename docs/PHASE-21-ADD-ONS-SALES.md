# Phase 21: add-on modules, and the first one: Sales invoices

## Add-on modules

Optional modules a company can use or ignore. They are **off until an administrator switches them on** (Settings, Add-on modules). Each one stands alone: its own tables, nothing read from or written to Accounts, Purchase or Site work. Switching one off only hides it; its data stays and comes back when it is switched on again.

- The list of add-ons is `apps/web/src/lib/addons.ts`. A company's switches are stored on the company (`Organization.addons`).
- Every action of an add-on checks two things: the company has switched it on, and the person holds the permission. A direct link or request to an add-on that is off is refused (pages send people to the switch page).
- The menu shows an add-on only when it is on and the role may open it (the sidebar and the phone More menu).
- Each switch is written to the activity log.

## Sales invoices (GST tax invoices you issue to your own customers)

Permissions: administrators and accountants (`sales:view`, `sales:write`). Other roles never see it.

- **Company details** (Sales, Settings): legal name, GSTIN (checked, including its check character), state, address, bank details, terms, invoice prefix. Printed on every invoice. Your state decides the tax.
- **Customers**: name, GSTIN (state read from it), address. Separate from suppliers.
- **New invoice**: customer, dates, place of supply (starts as the customer's state), items with HSN/SAC, quantity, unit, rate, discount %, GST rate. Same state: CGST + SGST. Another state: IGST. Totals are worked out in whole paise and rounded to the rupee, with the round-off shown. A live total on the form uses the same rules as the server.
- **Numbering**: `PREFIX/2026-27/0001`, restarting each financial year (1 April to 31 March), no number skipped or used twice, even for two people issuing at once. A cancelled invoice keeps its number.
- **The invoice**: a printable tax invoice (Print or save as PDF), amount in words (lakh and crore), bank details and terms. What was printed stays as issued even if the customer is edited later.
- **Payments received**: part and full payments, never more than the balance (two at once cannot exceed it), removing a payment brings the status back. Status: Unpaid, Part paid, Paid, Cancelled, with Overdue shown from the due date.
- **Cancel**: only an invoice with no payments. It stays in the list as Cancelled and is left out of totals and downloads.
- **Downloads for the accountant** (CSV, open in Excel): invoices by tax rate in the GSTR-1 layout (B2B with GSTIN, B2C without), HSN/SAC summary, and a plain invoice list. A name starting with `=`, `+`, `-` or `@` is neutralised so it cannot run as a spreadsheet formula.

Tested: 40+ rule checks (tax split, rounding, financial years, amount in words, CSV safety) and 15 database checks (add-on off by default and per company, permissions, GSTIN and state rules, numbering across years, payments, simultaneous payments, cancelling, downloads, company separation, off and on again), plus a run in the browser: switch on, company details, add a customer, issue an invoice, the printed page, the downloads and the phone width. A formula-in-a-name and a form-inside-a-form bug found in the browser run were fixed.

## Not included (yet)

- E-invoice (IRN and QR code), e-way bill, credit notes, quotations, recurring invoices, TDS on sales.
- Emailing or WhatsApp-sharing an invoice (print or save as PDF for now).
- The phone app does not show Sales yet.
- A price or plan rule for add-ons (today any company can switch one on).

## To go live

Run the migration `20261115090000_addons_sales` on the live database. Nothing changes for any company until an administrator switches the add-on on.
