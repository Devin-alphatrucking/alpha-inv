# Phase 13: Technical module, site work (first version)

What an engineer on site can now do in the web app (works in a phone browser, the camera opens from "Add photos"):

1. **Daily report** per project per day: weather, workers on site, work done, machinery, materials, problems, safety note.
   - One report per project per day. Saving again changes that report.
   - It starts as a **Draft**. **Save and submit** locks it. Only a project manager (or administrator) can change a submitted report or **reopen** it.
   - A report cannot be for a day that has not come yet (the company's own time zone decides what "today" is).
2. **Photos**: JPEG, PNG or WebP, up to 8 MB each, 10 at a time. The phone shrinks big photos before sending. The server checks what the file really is (not its name), so a web page renamed `.jpg` is refused. Each photo can have a place ("Tower A, level 3") and a note, and belongs to a project, optionally to one day's report or one issue.
   - Photos are never public links. They are opened through `/api/site/photos/<id>`, which checks the person's company and project.
   - Adding or deleting photos on a submitted report is for managers only.
3. **Issues (snags)**: title, details, place, how serious (low / medium / high), fix-by date, who it is given to.
   - Status: Open, In progress, Fixed, Closed. Anyone who writes site work can start work or mark fixed (or say a "fixed" one is not). Only a manager closes an issue or reopens a closed one.
   - An open or in-progress issue past its date shows **Overdue**.
   - An issue can only be given to someone who can see that project.
   - An issue can be edited by whoever raised it, whoever it is given to, or a manager.

## Who can do what

| Role | See | Write reports, photos, issues | Submit-lock, reopen, close |
|---|---|---|---|
| Administrator | all projects | yes | yes |
| Project manager | assigned projects | yes | yes |
| Site engineer | assigned projects | yes | no |
| Accountant, Purchase | all projects | read only | no |
| Viewer | assigned projects | read only | no |
| Staff | no site work | no | no |

"Assigned projects" means someone who is not assigned to a project cannot tell its reports, photos or issues exist (not found, not "no permission").

## Where it is in the app
- `/site` overview: for each project, is today's report written, open and overdue issues, recent reports, latest photos.
- `/site/report?project=&date=`, `/site/issues`, `/site/issues/<id>`, `/site/photos`.
- On a phone: **More > Site work**.

## Under the hood
- Tables `SiteReport`, `SitePhoto`, `SiteIssue` (migration `20261104090000_site_work`), each with the company column and row-level security like the other company tables.
- Rules (pure, unit-tested): `src/lib/site/rules.ts`. Database work: `src/lib/flows/site.ts`. Photo storage reuses the invoice file storage (local folder in development, Azure Blob when configured), file names start with `site-`.
- Permissions `site:view`, `site:write`, `site:manage` in `src/lib/roles.ts`.
- Tests: `src/lib/site/rules.test.ts` and `tests/site.test.ts` (15 database checks: access by role, one report a day, locking, photo checks, issue steps and races, company isolation).

## Not in this version
Progress percent by task, drawings and documents, offline saving on the phone and the mobile app screens (the mobile app cannot yet be tried on a real device from here), notification emails when an issue is given to someone, PDF export of a report, edit history.
