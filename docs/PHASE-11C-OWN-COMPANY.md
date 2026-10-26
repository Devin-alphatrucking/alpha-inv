# Phase 11c: Start a company of your own (for people who already have an account)

Status: BUILT and tested (7 database checks, all earlier suites, and a run in the browser: created from the Account page, switched into it, company menu and role shown).

## The problem it solves
One person can belong to many companies (one sign-in, a role in each). But the sign-up form refuses an email that already has an account, so an employee could not start a company of their own with the same email.

## What it does
**Account page, "Start a company of your own"** (also a link at the bottom of the company menu at the top): enter a company name and country. A new company is created with its own 14-day free trial, its own plan, people and data, starter categories and a first project, and the person is its **administrator**. The session moves into it at once.

- Nothing changes in the person's other companies: they stay "staff" (or whatever they were) there, and the employer cannot see the new company or its data (isolation is by the database).
- Billing, trial, plan limits and locking are **per company**. The new company's trial and plan have nothing to do with the employer's.
- The company menu shows both; switching keeps one sign-in, one password, one two-step setting.
- Limits: the email must be confirmed; **3 new companies a day** and **5 companies where the person is administrator** (closed companies do not count), so the free trial cannot be farmed.
- Logged as "company created" in the new company's activity log.

## Not included
- Phone app screen for this (use the website).
- Moving data between companies.
- A "transfer ownership" tool.
