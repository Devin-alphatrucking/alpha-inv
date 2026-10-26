// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { canEditReport, checkPhoto, cleanLabel, cleanText, isOverdue, issueOrder, nextStatuses, parseIssue, parseReport, PHOTO_MAX_BYTES, summariseIssues } from "./rules";

const TODAY = "2026-10-26";
const good = { reportDate: "2026-10-26", workDone: "Slab shuttering on level 3", labourCount: "24", weather: "Clear" };

// ---- cleaning text
assert.equal(cleanText("  a\r\nb  \n\n\n\nc "), "a\nb\n\nc");
assert.equal(cleanText("hi" + String.fromCharCode(0) + String.fromCharCode(0x202e) + "there"), "hithere");
assert.equal(cleanText(42), "");
assert.equal(cleanLabel("  Tower A \n 3rd floor "), "Tower A 3rd floor");
assert.equal(cleanLabel("   "), null);
assert.equal(cleanLabel("x".repeat(500))!.length, 160);

// ---- daily report
const r = parseReport(good, TODAY);
assert.ok(r.ok && r.value.labourCount === 24 && r.value.machinery === null && r.value.weather === "Clear");
assert.ok(!parseReport({ ...good, reportDate: "2026-10-27" }, TODAY).ok, "tomorrow");
assert.ok(!parseReport({ ...good, reportDate: "2026-02-30" }, TODAY).ok, "not a real day");
assert.ok(!parseReport({ ...good, reportDate: "26-10-2026" }, TODAY).ok);
assert.ok(!parseReport({ ...good, reportDate: "1999-01-01" }, TODAY).ok);
assert.ok(!parseReport({ ...good, workDone: " ab " }, TODAY).ok);
assert.ok(!parseReport({ ...good, workDone: "x".repeat(4001) }, TODAY).ok);
assert.ok(parseReport({ ...good, workDone: "x".repeat(4000) }, TODAY).ok);
for (const bad of ["-1", "2.5", "abc", "100001"]) assert.ok(!parseReport({ ...good, labourCount: bad }, TODAY).ok, bad);
assert.ok(parseReport({ ...good, labourCount: "" }, TODAY).ok && (parseReport({ ...good, labourCount: "" }, TODAY) as { value: { labourCount: null } }).value.labourCount === null);
assert.ok(parseReport({ ...good, labourCount: 0 }, TODAY).ok, "zero workers is fine");
assert.ok(!parseReport({ ...good, problems: "x".repeat(2001) }, TODAY).ok);
const badField = parseReport({ ...good, safetyNote: "x".repeat(2001) }, TODAY);
assert.ok(!badField.ok && badField.field === "safetyNote");
assert.ok(!parseReport(null, TODAY).ok);

// ---- who can edit a report
assert.equal(canEditReport("DRAFT", true, false), true);
assert.equal(canEditReport("DRAFT", false, false), false);
assert.equal(canEditReport("SUBMITTED", true, false), false, "locked once submitted");
assert.equal(canEditReport("SUBMITTED", true, true), true, "a manager can");

// ---- issues
const issue = parseIssue({ title: "  Cracked beam  ", severity: "HIGH", dueDate: "2026-11-01", assigneeId: " u1 " });
assert.ok(issue.ok && issue.value.title === "Cracked beam" && issue.value.assigneeId === "u1" && issue.value.description === null);
assert.ok(!parseIssue({ title: "ab", severity: "LOW" }).ok);
assert.ok(!parseIssue({ title: "Fine title", severity: "URGENT" }).ok);
assert.ok(!parseIssue({ title: "Fine title", severity: "LOW", dueDate: "2026-13-01" }).ok);
assert.ok(!parseIssue({ title: "x".repeat(121), severity: "LOW" }).ok);
assert.ok(parseIssue({ title: "Fine title", severity: "LOW", dueDate: "" }).ok);

// transitions
assert.deepEqual(nextStatuses("OPEN", false), ["IN_PROGRESS", "FIXED"]);
assert.ok(nextStatuses("OPEN", true).includes("CLOSED"));
assert.ok(!nextStatuses("FIXED", false).includes("CLOSED"), "only a manager accepts the fix");
assert.deepEqual(nextStatuses("FIXED", true), ["OPEN", "CLOSED"]);
assert.deepEqual(nextStatuses("CLOSED", false), []);
assert.deepEqual(nextStatuses("CLOSED", true), ["OPEN"]);

// overdue and counts
assert.equal(isOverdue({ status: "OPEN", dueDate: "2026-10-25" }, TODAY), true);
assert.equal(isOverdue({ status: "OPEN", dueDate: TODAY }, TODAY), false, "due today is not late");
assert.equal(isOverdue({ status: "FIXED", dueDate: "2026-10-01" }, TODAY), false);
assert.equal(isOverdue({ status: "IN_PROGRESS", dueDate: null }, TODAY), false);
const counts = summariseIssues(
  [
    { status: "OPEN", severity: "HIGH", dueDate: "2026-10-01" },
    { status: "IN_PROGRESS", severity: "HIGH", dueDate: null },
    { status: "FIXED", severity: "HIGH", dueDate: null },
    { status: "CLOSED", severity: "LOW", dueDate: "2026-01-01" },
  ],
  TODAY,
);
assert.deepEqual(counts, { open: 1, inProgress: 1, fixed: 1, closed: 1, stillOpenHigh: 2, overdue: 1 });

// ordering
const mk = (severity: "LOW" | "MEDIUM" | "HIGH", dueDate: string | null, day: number) => ({ severity, dueDate, createdAt: new Date(Date.UTC(2026, 9, day)) });
const sorted = [mk("LOW", null, 1), mk("HIGH", null, 2), mk("HIGH", "2026-11-01", 3), mk("MEDIUM", null, 4)].sort(issueOrder);
assert.deepEqual(sorted.map((x) => [x.severity, x.dueDate]), [["HIGH", "2026-11-01"], ["HIGH", null], ["MEDIUM", null], ["LOW", null]]);

// ---- photos
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const webp = Uint8Array.from([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBP")]);
const gif = Uint8Array.from(Buffer.from("GIF89a......"));
const html = Uint8Array.from(Buffer.from("<html><script>"));
assert.deepEqual(checkPhoto(jpeg, 1000), { ok: true, contentType: "image/jpeg" });
assert.deepEqual(checkPhoto(png, 1000), { ok: true, contentType: "image/png" });
assert.deepEqual(checkPhoto(webp, 1000), { ok: true, contentType: "image/webp" });
assert.ok(!checkPhoto(gif, 1000).ok);
assert.ok(!checkPhoto(html, 1000).ok, "a web page renamed .jpg");
assert.ok(!checkPhoto(jpeg, 0).ok);
assert.ok(!checkPhoto(jpeg, PHOTO_MAX_BYTES + 1).ok);
assert.ok(checkPhoto(jpeg, PHOTO_MAX_BYTES).ok);
assert.ok(!checkPhoto(new Uint8Array(), 10).ok);

console.log("site rules: all checks passed");
