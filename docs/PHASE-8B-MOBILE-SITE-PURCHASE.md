# Phase 8b: Mobile app, site work, material requests and deliveries

The phone app (Expo) now covers the new modules as well as Accounts. Which tabs a person sees follows their role: the server sends the list of what the role may do in `/api/v1/me` (`permissions`), the app hides the rest, and the server still checks every request.

| Role | Tabs |
|---|---|
| Site engineer | Invoices, Upload, **Site**, **Purchase**, Account |
| Project manager | Invoices, Upload, Site, Purchase (can approve), Account |
| Purchase officer | Invoices, Upload, Site (read), Purchase (requests, deliveries), Account |
| Administrator | everything |
| Accountant, Viewer | Invoices, Site (read), Purchase (read); Upload only if the role may upload |
| Staff | Invoices, Upload, Account (as before) |

## Screens
**Site tab**
- Each project's card: today's report status, open and overdue issues.
- **Daily report:** weather, workers, work done, machinery, materials, problems, safety note; save draft, save and submit, reopen (managers); step back and forward through days; **photos** from the camera or gallery (a draft is saved first when there is none yet); tap a photo to see it full screen, hold or use Delete to remove it.
- **Issues:** list with filters, raise an issue (severity, where, fix-by date, who it is given to), issue screen with the next allowed steps (start work, mark fixed; only a manager closes), photos.
- **Photos:** all photos of a project, add more.

**Purchase tab**
- Material requests with filters; **new request** (items, quantity, unit, needed-by date, note) saved as a draft or sent for approval at once; change a draft.
- Request screen: send for approval, take it back, cancel; managers **approve or reject** (a rejection needs a reason).
- **Deliveries:** orders sent to suppliers and waiting for goods (late ones marked); open one to see ordered / received / refused / to come and **record a delivery** (challan number, accepted and refused quantity per item, remark), add photos of the challan and goods, or remove a delivery. **No prices appear anywhere in the app's delivery screens.**
- Orders themselves (supplier, rates) are made on the website.

## Server API (`/api/v1`, phone sign-in, JSON)
| | |
|---|---|
| `GET /me` | adds `permissions` |
| `GET /site/overview` | projects with today's report and issue counts |
| `GET /site/reports?projectId&date`, `PUT /site/reports` | read / save a day's report; `POST /site/reports/<id>` `{action: submit\|reopen}` |
| `GET/POST /site/issues`, `GET/PATCH/POST /site/issues/<id>`, `GET /site/people` | issues, details, `{status}` steps, people to give it to |
| `GET/POST /site/photos`, `GET/DELETE /site/photos/<id>` | list, add (multipart), open the picture, delete |
| `GET/POST /purchase/requests`, `GET/PUT/POST /purchase/requests/<id>` | requests; `POST {action: submit\|withdraw\|cancel\|approve\|reject, note}` |
| `GET /deliveries`, `GET/POST /deliveries/<orderId>`, `DELETE /deliveries/receipts/<id>` | deliveries (no prices) |

Every endpoint uses the same rules as the website (the same flows): project access, role permissions, locked reports, one-day-one-report, status steps, company isolation. A failure comes back as `{ error, code: "rejected", field }` with status 400 (plain words the app shows as they are), 403 for a role without the permission, 404 for something that is not visible to the person, 401 for no sign-in. Photos are never public: the app loads each one with its sign-in header.

## Tested
- `tests/mobile-modules.test.ts` (9 database checks): permissions in `/me`, role and project access on every endpoint, photo upload and opening with the phone's sign-in (and refused without it, for other projects and for other companies), approvals, deliveries without prices, company isolation.
- `apps/mobile/scripts/test-client.ts` (13 checks, against the running server with an engineer's account): the phone client library end to end, including a real multipart photo upload.
- The app type-checks and the whole app bundles for Android with Metro (Hermes, 2.6 MB).

## NOT done or NOT verified
- **No screen has been run on a phone or simulator.** Layout, keyboard behaviour, the camera, the gallery picker and full-screen photos still need your device (see PHASE-8 section 4: `npx expo start`).
- **No offline saving yet.** A report, photo or delivery needs a connection when you press save; photos that fail to upload show a message and can be tried again. Saving on the phone and sending later is the next step and the most valuable one for poor site signal.
- No editing of an issue's details, no order screens, no Google sign-in in the app, no push notifications.
