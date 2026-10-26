# Product plan: three modules on one platform

This is the map of the whole product: what exists, what does not, how people sign in and use it, and the order to build the rest.
Written 26 Oct 2026. Nothing in section 3 or 4 is built yet: those are proposals for you to change.

## 1. The big picture

One web app and one mobile app, shared by many companies. Each company buys **plans** (one plan = one project), invites its **people**, and works in three modules that share the same projects, suppliers and materials.

```
            SITE (Technical module)                OFFICE (Purchase module)            OFFICE (Accounts module)
   engineer on site                         purchase officer                         accountant / owner
   daily report, photos, issues  ──needs──▶ material request ──▶ purchase order ──▶  invoice ──▶ payment ──▶ GST
              ▲                                                        │                 ▲
              └────────── material received (delivery check) ◀─────────┘─────────────────┘
                                   "3-way match": order = delivery = invoice
```

The value of the three together: an order is raised from a site need, the delivery is confirmed on site, and the supplier's invoice is checked against both before it is paid. Today only the last part (Accounts) exists.

## 2. What is built today

### Platform (shared by all modules): BUILT
| Part | What it does | Where documented |
|---|---|---|
| Companies and branding | Many companies in one database, kept apart by the database itself; each has its logo, name and colours | PHASE-2 |
| Plans, limits, support | One plan = one project; user limit; AI page limit; support tickets by email | PHASE-4 |
| Payments (Razorpay) | Buying and renewing plans, grace period, webhooks. Not yet tried with real Razorpay keys | PHASE-5 |
| Master console (our team) | Look at every company, plans, tickets, logs; set up a company by hand; reset someone's two-step; export a company's data | PHASE-6, PHASE-10 section 10 |
| Mobile API and app | iPhone and Android app on the same accounts: sign in, invoices, upload, locked screen. Not yet run on a real phone | PHASE-7, PHASE-8 |
| Two-step sign-in | Authenticator-app codes and recovery codes; required for our team | PHASE-9 |
| Paywall | After the trial, company data is locked until a plan is paid | PHASE-10 section 1 |
| Public pages | Landing page, pricing page, sign-up | PHASE-10 section 9 |
| Quality round 1 | Fixes for payment races, overdue status, sessions, exports | QUALITY-ROUND-1 |

### Module 1, Accounts: BUILT (this is the finished module)
| Area | Features |
|---|---|
| Invoices | Upload PDF or photo (one or many at once), AI reading, review and confirm, duplicate protection, edit, delete, comments on each invoice, invoice detail page |
| Payments | Record full or part payments, status kept right automatically, payment history, **payment planner** (week-by-week cash needs, pay several bills in one run, payables CSV) |
| Suppliers | List, statements (what you bought, paid, owe), **merge duplicates**, GSTIN checks |
| Tax | **GST report** by month and supplier with CSV, checks for missing or wrong GSTINs and inconsistent tax |
| Control | Project budgets with alerts at 80% and 100%, **rate alerts** when a price is far above usual, **price comparison** between suppliers, dashboard with "needs attention", daily email digest |
| Reference data | Categories, Rate Sheet (materials and average rates), activity log, error log, data export to Excel or JSON |

### Module 2, Technical (site work): FIRST VERSION BUILT (web)
Daily site report, site photos and issues are built (see PHASE-13-TECHNICAL-SITE-WORK.md). Not built yet: progress percent, drawings and documents, offline saving and the mobile app screens.
### Module 3, Purchase (orders): FIRST VERSION BUILT (web)
Material requests, approval and purchase orders are built (see PHASE-12-PURCHASE.md). Delivery check and matching a bill to its order are built too (Phase 14). Not built yet: quotes, emails.

## 3. How people sign in and work (today, and what changes)

**Today**
1. A company owner opens the website, taps **Start free trial**, enters company name, their name, email and password.
2. They confirm their email (link in an email). They are now the company's **Administrator**.
3. They set up projects, categories and suppliers, then **invite** their team by email. An invited person sets their own password.
4. There are two roles per company: **Administrator** (sees and does everything, buys plans, manages people) and **Staff** (sees only the projects they are assigned to and the invoices they uploaded; uploads and reviews invoices).
5. Staff and administrators use the website or the mobile app with the same login. Anyone can add two-step sign-in. The trial lasts 14 days; then the company must buy a plan or its data is locked (not deleted).
6. Our own team signs in to the **master console** at `/master` (two-step required) to help customers.

**What the three modules need: more roles.** Two roles are too few once site and purchase work arrive. Proposed:

| Role | Accounts | Purchase | Technical (site) |
|---|---|---|---|
| Administrator (owner) | everything | everything | everything |
| Accountant | full (invoices, payments, GST) | view orders | view |
| Purchase officer | upload invoices, see suppliers and prices | raise and send orders, receive quotes | view requests |
| Project manager | view own projects' spend and budgets | approve material requests, see orders | see all reports for own projects |
| Site engineer | upload an invoice or bill photo | raise material requests | daily reports, photos, issues, confirm deliveries |
| Viewer (client, auditor) | read only | read only | read only |

Each person is attached to projects, as Staff are today. A person can hold different roles in different companies.

## 4. The modules still to build

### Module 3, Purchase: from need to order to delivery
1. **Material request (indent)**: site engineer asks for items, quantity and needed-by date for a project.
2. **Approval**: project manager approves or rejects with a note. (You removed approvals for large invoices earlier; this is a different step, before money is committed. Say if you want it off too.)
3. **Purchase order (PO)**: purchase officer picks the supplier and items (from the Rate Sheet, with the usual rate and the cheapest supplier shown), sets rate, GST, delivery date, payment terms, and gets a numbered PO as a PDF to send or email to the supplier. Statuses: draft, sent, part delivered, delivered, closed, cancelled.
4. **Quotes** (later): ask several suppliers, compare, choose.
5. **Delivery check (GRN)**: on site, record what actually arrived against the PO, with photos of the challan; part deliveries allowed.
6. **Match to invoice**: when the supplier's invoice is read, link it to its PO. Flag extra quantity, higher rate or items never ordered **before it can be paid**.
7. **Reports**: open orders, late deliveries, spend committed vs invoiced vs paid per project, supplier delivery performance.

### Module 2, Technical: what happens on site
1. **Daily site report**: date, weather, work done (by area or task), labour count, machinery, materials used, problems.
2. **Photos and files**: engineers take photos on the phone, tag project, area and date, add a note; drawings and documents per project. Works on poor signal (saved on the phone, sent later).
3. **Issues and snags**: raise a problem with photo, assign to someone, due date, mark fixed, with history.
4. **Progress**: percent complete by task or area, shown against the plan and the budget.
5. **Material received**: the same delivery check as in Purchase (one screen, two modules).
6. **Later**: requests for information, safety checklists, labour attendance, equipment log.

### How it fits the plans and billing (decision needed)
Today a plan covers one project with all features. Options: (a) every plan includes all three modules; (b) Accounts is the base and Purchase and Technical are add-ons with their own price. Your choice, it changes pricing page and limits.

## 5. Build order (phases)

Phase 1 to 10 are done (section 2). Proposed next phases, each ending with tests, a browser or phone check, and your approval before commit:

| Phase | Name | Why this order |
|---|---|---|
| 11 | **Roles and permissions** (BUILT, see PHASE-11-ROLES.md) | Every later module needs the new roles; cheapest to do first and it improves Accounts too |
| 12 | **Purchase: material requests and purchase orders** (web BUILT, see PHASE-12-PURCHASE.md) | The supplier and rate data already exists; gives the biggest new value for the office |
| 13 | **Technical: daily report, photos, issues** (web BUILT, see PHASE-13-TECHNICAL-SITE-WORK.md; mobile screens and offline saving still to do) | Needs the mobile app to be solid; photo upload and offline saving are the hard part |
| 14 | **Delivery check and 3-way match** (BUILT, see PHASE-14-DELIVERY-AND-MATCH.md) | Connects Purchase, Technical and Accounts; needs 11 to 13 first |
| 15 | **Reports and dashboards across modules** | Committed vs invoiced vs paid, delays, supplier performance |
| 16 | **Real-world hardening** | Real Razorpay purchase, real Azure reading, mobile on a phone, hosting, email, rotating credentials |

## 5b. Added after the first draft (your requests)

| Phase | Name | What |
|---|---|---|
| 11b | **One-time codes (OTP)** (BUILT, see PHASE-11B-ONE-TIME-CODES.md) | A 6-digit code replaces or backs up the email links: sign-up confirmation, password reset, joining by invitation, and a "confirm it is you" step before risky actions (change email or password, remove a person, close the company, record a payment run). Codes expire in 10 minutes, are single use, limited to 5 tries, and work in the phone app without leaving it. |
| 11c | **Create another company** (BUILT, see PHASE-11C-OWN-COMPANY.md) | A signed-in person (for example an employee) creates their own company from the company switcher, with its own trial, without a new password. |
| 17 | **Client management (master console)** | A funnel and health view of every client, notes, reminders, trial-ending emails and revenue, so our team can manage clients after onboarding. See the master console section of the chat summary. |

## 6. Open decisions for you

1. Are the six roles in section 3 right, and are the names what your customers use?
2. Should a material request need approval before a PO, always or only above an amount?
3. Plans: all three modules in every plan, or Accounts plus paid add-ons?
4. Site work: do engineers need it to work with no signal (offline), from day one?
5. PO: do you need printed PO formats with your customer's logo and terms (we can build that into the PDF)?
6. Which comes first for your first customers: Purchase or Technical?
7. Waiting for your approval: the last four Accounts modules (payment planner, supplier merge, price comparison, GST checks) are built but not committed.
