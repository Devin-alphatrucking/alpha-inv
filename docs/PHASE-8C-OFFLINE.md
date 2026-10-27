# Phase 8c: saving without a connection (phone app)

Site engineers often have no signal. Raising an issue, asking for materials and recording a delivery now work
without one: the phone keeps what was entered (and its photos) and sends it when it can.

## What works offline

| Action | Offline |
| --- | --- |
| Raise an issue, with photos | Yes |
| New material request (draft or send for approval) | Yes |
| Record a delivery against an order, with photos | Yes |
| Changing a draft request, approving, closing an issue, daily report, deleting | No (needs the server's current state) |

Everything else in the app still needs a connection to load. An already-open screen keeps showing what it loaded.

## How it behaves

1. The form's save keeps the item in a small file in the app's own folder (photos are copied there too, because the
   phone may clear the camera's cache), then tries to send it at once.
2. Connected: it goes straight through and the screen moves on as before. Nothing is left on the phone.
3. No signal, server down (5xx), busy (429) or timeout: the item stays kept. The person sees "Saved on this phone".
4. A bar on the Home, Site and Purchase tabs says how many are waiting. Tapping it opens "Waiting to send" with
   Send now, Try again and Throw away.
5. Sending is tried again when the app comes to the front and every 30 seconds while something waits.
6. If the server refuses it (a rule, a closed order): before anything was saved the form shows the reason and keeps
   what was typed. If the record was saved but its photos were refused, the item shows "Needs a look" and is never
   retried by itself.
7. Items belong to one person and one company. Another person signing in on the same phone does not see or send them.

## Why sending twice is safe

Each item carries a reference (its own id). The server stores it with the record under a unique
(company, reference) key and returns the first record for any repeat. So a reply lost on a bad connection, or two
syncs overlapping, cannot make a second issue, request or delivery (or count a delivery's quantities twice). Photos
get their own references (`<ref>-b<batch>-<index>`), ten per batch, so a connection lost halfway resumes with the
missing batches only. A reference can only be used again by the person who first used it.

Server side: `lib/idempotency.ts`, `clientRef` columns (migration `20261109090000_client_refs`) on issues, material
requests, goods receipts and site photos, handled in `createIssue`, `saveRequest`, `recordReceipt`, `addPhotos`.

## Phone side

- `src/lib/offline/queue.ts`: queue, sending rules and outcomes (no React Native imports, tested in Node).
- `src/lib/offline/device.ts`: the file-system storage (`expo-file-system`).
- `src/lib/offline/provider.tsx`: keeps the list in step, syncs on foreground and on a timer.
- `src/components/pending-bar.tsx`, `src/app/(app)/pending.tsx`, `src/components/local-photos.tsx`.

Limits: 100 items waiting; 10 photos per item.

## Tests

- `apps/web/tests/idempotency.test.ts` (database suite, part of `npm run test:isolation`): repeats, five at once,
  numbering not skipped, quantities counted once, another person's reference refused, same text in two companies.
- `apps/mobile/scripts/test-offline.ts` (`npm run test:offline` in `apps/mobile`): queue and sending rules against a
  pretend server that remembers references (lost reply, resume after a dropped batch, refusals, signed out, other
  person's items, damaged file, many saves at once, limits).
- Purchase test made deterministic: the overview check no longer depends on which of two racing decisions won.

## Not verified here

The file storage, camera and background/foreground behaviour need a real phone (airplane-mode trial: raise an issue
with photos, restore signal, confirm it arrives once).
