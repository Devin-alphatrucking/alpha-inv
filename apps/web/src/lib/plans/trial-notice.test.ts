import assert from "node:assert/strict";
import { daysLeft, trialNoticeDue } from "./trial-notice";

const now = new Date("2026-11-10T10:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * 86_400_000);
const due = (trialEndsAt: Date | null, endingNoticeAt: Date | null = null, endedNoticeAt: Date | null = null) => trialNoticeDue({ trialEndsAt, endingNoticeAt, endedNoticeAt, now });

assert.equal(due(null), null, "no trial");
assert.equal(due(at(10)), null, "plenty of time");
assert.equal(due(at(3.01)), null, "just over three days");
assert.equal(due(at(3)), "ending", "three days left");
assert.equal(due(at(0.2)), "ending", "last day");
assert.equal(due(at(2), now), null, "already told it is ending");
assert.equal(due(at(-0.1)), "ended", "just ended");
assert.equal(due(at(-6.9)), "ended", "within the week");
assert.equal(due(at(-7.1)), null, "too long ago to announce");
assert.equal(due(at(-1), now, now), null, "already told it has ended");
assert.equal(due(at(-1), now, null), "ended", "having been told 'ending' does not stop 'ended'");
assert.equal(due(at(5), now, now), null, "an extended trial with old marks cleared is told again; with marks it is not");
assert.equal(due(at(2), null, now), "ending", "an ended mark from a previous trial does not hide a new 'ending'");

assert.equal(daysLeft(at(2.2), now), 3);
assert.equal(daysLeft(at(0.1), now), 1);
assert.equal(daysLeft(at(-1), now), 0);

console.log("trial notice: all checks passed");
