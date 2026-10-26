# Phase 11: Roles and permissions

Status: BUILT and tested (roles table unit-tested, 6 database checks, all earlier suites). Not yet looked at in the browser or on a phone with a non-administrator role.

## 1. The roles

A person holds one role **per company** (the same person can be an accountant in one company and the administrator of another).

| Role | Sees | Can do |
|---|---|---|
| **Administrator** | every project | everything: people, plans, settings, logs, exports |
| **Accountant** | every project | invoices (upload, review, delete), payments (record, delete, planner), suppliers, categories, Rate Sheet, price comparison, GST report, budgets. Not: people, plans, settings, logs, export, creating projects |
| **Purchase officer** | assigned projects | upload and review invoices, manage suppliers, Rate Sheet, price comparison, comment |
| **Project manager** | assigned projects | upload and review invoices, budgets and spend, Rate Sheet, comment |
| **Site engineer** | assigned projects | upload and review bills, comment |
| **Viewer** | assigned projects | read only: dashboard, invoices, projects, budgets. Cannot upload, review, comment or change anything |
| **General staff** | assigned projects | the original role, unchanged: upload, review, record payments on their invoices |

"Assigned projects" means the projects the administrator ticked for that person, plus any invoice they uploaded themselves. Roles that see every project (Administrator, Accountant) need no assignments.

## 2. How it works (one table)

`src/lib/roles.ts` holds the roles, the permission list for each, which roles see every project, and which screens each permission opens. The pieces that enforce it all read that one table:

- **Sign-in guard** (`proxy.ts`): a person who opens a page their role may not open is sent to a page they can work in (upload for site roles, the dashboard otherwise). A session with an unknown role is sent to sign in again.
- **Pages and actions**: each screen and each server action checks its own permission (GST report, planner, price comparison, payments, vendors, invoices, comments, budgets). The CSV downloads check too.
- **Menus**: the website sidebar and the phone's bottom bar show only what the role may open. The phone bar shows Projects in place of Payments for roles without payments.
- **Data scope**: `invoiceAccessWhere` and `projectAccessWhere` use "sees every project", so adding a role never needs a change in each query.
- **Invitations and the Users screen**: choose any of the seven roles, with a one-line description; project ticking appears for roles that need it. At least one Administrator must remain.
- **Role changes** take effect within a minute (the sign-in token is re-checked against the database), and on the phone API on the next request.

## 3. Changes you might notice
- Project budgets and spend were visible to anyone with access to a project; they are now shown only to roles with budget access (Administrator, Accountant, Project manager, Viewer), and only for projects they can see.
- A role that may not upload can no longer reach the upload page or the upload endpoint (the phone app uses the same endpoint).
- A role that may not review is sent to the read-only invoice page instead of the review form.
- Found and fixed while testing: the payment run's "just submitted" message could show a generic "too many attempts" message when two identical requests raced; its tests also depended on the time of day in India.

## 4. Not included
- Per-project roles (the same person as manager on one project and viewer on another). Roles are per company.
- Custom roles you design yourself.
- A role that can approve material requests: that comes with the Purchase module.
