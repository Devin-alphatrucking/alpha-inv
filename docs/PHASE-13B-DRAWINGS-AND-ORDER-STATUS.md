# Phase 13b and 12b: drawings with revisions, and order status that follows deliveries

## 1. Drawings and documents (Technical module)
A document library per project: **Site work > Drawings** (`/site/drawings`).

- A drawing has a **title**, an optional **drawing number** (for example S-101, unique inside the project), a **category** (Architectural, Structural, MEP, Site plan, Specification, Contract, Other) and an optional description.
- Its files are **revisions** (A, B, R2, 01 ...). Adding a revision makes it the **current** one, the one to build from. Older revisions stay in the history with who issued them, the date and "what changed". A revision name cannot be used twice, and the form suggests the next one (A to B, R2 to R3).
- **Formats:** PDF, JPEG, PNG, WebP, AutoCAD **DWG** and **DXF**, Word, Excel, PowerPoint, up to 30 MB. Each file is checked by its first bytes **and** its name together, so a web page renamed `.pdf`, or a program renamed `.dwg`, is refused. PDFs and images open in the browser; DWG, DXF and Office files download. Files are served with a type of our own choosing, "no sniffing" and a sandbox policy, so an uploaded file can never run as a page.
- **Who:** everyone with site access to the project can read (administrator, accountant, purchase officer, project manager, site engineer, viewer; staff cannot). **Only an administrator or project manager issues drawings and revisions** (permission `document:write`), so the file the site works from is the one the office meant. Someone not on the project cannot tell a drawing exists.
- **Archive** hides a drawing from the lists; nothing is ever deleted (history for audit), and it can be restored. No revisions while archived.
- Search by title or number, filter by category and project.
- **Phone:** Site > project > **Drawings** lists them and shows the history. Opening a file asks the server for a **five-minute address** valid for that one file (the phone's browser cannot send the app's sign-in), and the person's access is checked again when it is used. Adding and revising drawings is done on the website.

Under the hood: tables `ProjectDocument`, `DocumentRevision` (company column and row-level security, migration `20261108090000_project_documents`), rules in `src/lib/site/document-rules.ts`, phone links in `src/lib/site/doc-links.ts`, database work in `src/lib/flows/documents.ts`. Tests: `src/lib/site/document-rules.test.ts` (unit) and `tests/documents.test.ts` (9 database checks), plus a phone API check in `tests/mobile-modules.test.ts`.

## 2. Order status follows the deliveries (Purchase module)
An order now moves by itself: **Draft, Sent, Part delivered, Delivered, Closed** (or Cancelled).

- **Sent to Part delivered to Delivered** happen automatically when a delivery is recorded, in the same transaction, so the status can never disagree with the deliveries. If a delivery is removed the status goes back (Delivered to Part delivered, to Sent). The day it was delivered in full is kept (`deliveredAt`).
- Once any goods have arrived the order can **no longer be cancelled**, only **closed** by the purchase officer or administrator. Closing a part-delivered order ("short close") needs a reason (the rest is not coming); closing a fully delivered one does not. A closed order takes no more deliveries, but a bill can still be linked to it.
- Order screens show the new statuses and filters, "Delivered in full on ..." and the close note; the Purchase page's "On order" figure counts orders sent but not yet fully delivered. The phone's delivery list and screen follow the same statuses.
- Orders already sent were brought up to date by the migration (`20261107090100_order_delivery_status_backfill`): on the demo data an order with 30 of 40 bags received became "Part delivered".

Tests: `src/lib/purchase/rules.test.ts` (status and close rules), `tests/delivery.test.ts` (status follows deliveries both ways, closing, no cancel after delivery).

## Not in this version
Linking an issue or a photo to a drawing; marking up a drawing on screen; adding or revising drawings from the phone; email when a new revision is issued; supplier-wise delivery performance report (Phase 15).
