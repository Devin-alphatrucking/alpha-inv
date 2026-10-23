// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { formatPrice, intervalLabel, landingEnabled, planView } from "./pricing";

// ---- price
assert.equal(formatPrice(199900, "INR"), "₹1,999");
assert.equal(formatPrice(150050, "INR"), "₹1,500.50");
assert.equal(formatPrice(2500000, "INR"), "₹25,000");
assert.equal(formatPrice(4900, "USD"), "$49");
assert.equal(formatPrice(null, "INR"), null, "no price set yet");
assert.equal(formatPrice(undefined, "INR"), null);
assert.equal(formatPrice(0, "INR"), null, "zero is not a price to advertise");
assert.equal(formatPrice(-100, "INR"), null);
assert.equal(formatPrice(NaN, "INR"), null);
assert.equal(formatPrice(Infinity, "INR"), null);
assert.equal(formatPrice(1000, "NOPE"), "NOPE 10", "an unknown currency code still reads sensibly");

// ---- interval
assert.equal(intervalLabel("MONTH"), "per month");
assert.equal(intervalLabel("YEAR"), "per year");
assert.equal(intervalLabel("anything"), "per month");

// ---- plan view
const base = { code: "PROJECT", name: "Project plan", priceMinor: 199900, currency: "INR", interval: "MONTH", includedProjects: 1, userLimit: 5, aiPagesPerProject: 500 };
const v = planView(base);
assert.equal(v.price, "₹1,999");
assert.equal(v.per, "per month");
assert.deepEqual(v.features, ["1 project", "Up to 5 team members", "500 AI-read pages per project each month", "Every feature included"]);
assert.equal(planView({ ...base, priceMinor: null }).price, null);
const big = planView({ ...base, includedProjects: 3, userLimit: 1, aiPagesPerProject: 1, interval: "YEAR" });
assert.deepEqual(big.features.slice(0, 3), ["3 projects", "Up to 1 team member", "1 AI-read page per project each month"]);
assert.equal(big.per, "per year");
assert.equal(planView({ ...base, aiPagesPerProject: 12000 }).features[2], "12,000 AI-read pages per project each month");

// ---- landing switch
assert.equal(landingEnabled(undefined), true);
assert.equal(landingEnabled(""), true);
assert.equal(landingEnabled("on"), true);
assert.equal(landingEnabled("off"), false);
assert.equal(landingEnabled(" OFF "), false);

console.log("pricing: all checks passed");
