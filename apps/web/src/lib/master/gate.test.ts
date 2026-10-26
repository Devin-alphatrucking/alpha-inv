// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { masterGate, normalizeHost } from "./gate";

const M = "admin.example.com";
const gate = (host: string, pathname: string, signedIn = true, masterHost: string | null = M) => masterGate({ masterHost, host, pathname, signedIn });

assert.equal(normalizeHost(" Admin.Example.COM. "), "admin.example.com");
assert.equal(normalizeHost(undefined), "");

// ---- feature off: nothing changes
for (const host of ["app.example.com", "localhost:3000", M]) for (const p of ["/", "/login", "/master", "/operator-login"]) {
  assert.deepEqual(gate(host, p, false, ""), { action: "pass" }, `${host}${p}`);
  assert.deepEqual(gate(host, p, false, null), { action: "pass" });
}

// ---- customer address: the console and the operator sign-in do not exist
for (const p of ["/master", "/master/companies", "/master/companies/x", "/api/master/export", "/operator-login"]) assert.deepEqual(gate("app.example.com", p), { action: "not_found" }, p);
for (const p of ["/", "/login", "/signup", "/dashboard", "/site", "/api/auth/session", "/masters-of-none", "/mastery"]) assert.deepEqual(gate("app.example.com", p), { action: "pass" }, p);

// ---- master address: only the console and what it needs
assert.deepEqual(gate(M, "/"), { action: "redirect", to: "/master" });
assert.deepEqual(gate(M, "/login"), { action: "redirect", to: "/operator-login" }, "signing out lands on the operator sign-in");
for (const p of ["/signup", "/dashboard", "/invoices", "/site", "/purchase", "/pricing", "/api/v1/auth/login", "/api/billing/razorpay/webhook", "/api/invoices/x/file", "/masters-of-none"]) assert.deepEqual(gate(M, p), { action: "not_found" }, p);
for (const p of ["/master", "/master/companies", "/api/master/export", "/account", "/operator-login", "/api/auth/session"]) assert.deepEqual(gate(M, p), { action: "pass" }, p);
assert.deepEqual(gate(M.toUpperCase(), "/master"), { action: "pass" }, "host case does not matter");
assert.deepEqual(gate("admin.example.com.evil.test", "/master"), { action: "not_found" }, "a look-alike address is not the master address");
assert.deepEqual(gate("evil.test", "/master"), { action: "not_found" });

// ---- signed out on the master address
assert.deepEqual(gate(M, "/master/companies", false), { action: "redirect", to: "/operator-login?callbackUrl=%2Fmaster%2Fcompanies" });
assert.deepEqual(gate(M, "/account", false), { action: "redirect", to: "/operator-login?callbackUrl=%2Faccount" });
assert.deepEqual(gate(M, "/api/master/export", false), { action: "not_found" }, "no sign-in page for API callers");
assert.deepEqual(gate(M, "/operator-login", false), { action: "pass" });
assert.deepEqual(gate(M, "/api/auth/callback/operator", false), { action: "pass" });

console.log("master gate: all checks passed");
