import assert from "node:assert/strict";
import { quietDays } from "./quiet-notice";

const now = new Date("2026-11-10T10:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const q = (o: { status?: string; created?: number; active?: number | null; notice?: number | null }) =>
  quietDays({ status: o.status ?? "ACTIVE", createdAt: ago(o.created ?? 200), lastActiveAt: o.active == null ? null : ago(o.active), lastNoticeAt: o.notice == null ? null : ago(o.notice), now });

assert.equal(q({ active: 5 }), null, "recently active");
assert.equal(q({ active: 13 }), null, "just under two weeks");
assert.equal(q({ active: 14 }), 14, "two weeks quiet");
assert.equal(q({ active: 40 }), 40);
assert.equal(q({ active: 91 }), null, "long gone");
assert.equal(q({ active: 20, status: "TRIAL" }), 20, "a trial counts");
assert.equal(q({ active: 20, status: "SUSPENDED" }), null, "suspended is left alone");
assert.equal(q({ active: 20, status: "CLOSED" }), null, "closed is left alone");
assert.equal(q({ active: null, created: 20 }), 20, "never active: counted from sign-up");
assert.equal(q({ active: null, created: 3 }), null, "a brand new company is not quiet");
assert.equal(q({ active: 40, notice: 10 }), null, "told recently");
assert.equal(q({ active: 60, notice: 31 }), 60, "told over a month ago");

console.log("quiet notice: all checks passed");
