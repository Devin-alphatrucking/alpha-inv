// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { distance, findDuplicateGroups, mergeProblem, normaliseName, whySame, type VendorLite } from "./duplicates";

let n = 0;
const v = (name: string, gstin: string | null = null, invoices = 0): VendorLite => ({ id: `v${++n}`, name, gstin, invoices });

// ---- names
assert.equal(normaliseName("Shree Cement Pvt. Ltd."), "SHREE CEMENT");
assert.equal(normaliseName("M/s. SHREE  CEMENT & Co."), "SHREE CEMENT");
assert.equal(normaliseName("The Shree Cement (P) Limited"), "SHREE CEMENT");
assert.equal(normaliseName("Mehta Steel & Hardware"), "MEHTA STEEL HARDWARE");
assert.equal(normaliseName("   "), "");
assert.equal(normaliseName("Pvt Ltd"), "", "only filler words leaves nothing to compare");
assert.equal(normaliseName("Sri Sai-Traders 2"), "SRI SAI TRADERS 2");

// ---- distance
assert.equal(distance("CEMENT", "CEMENT"), 0);
assert.equal(distance("CEMENT", "CEMNT"), 1);
assert.equal(distance("CEMENT", "CEMANT"), 1);
assert.equal(distance("CEMENT", "STEEL", 2), 3, "stops early past the limit");
assert.equal(distance("ABC", "ABCDEFGH", 2), 3);

// ---- why two look the same
assert.equal(whySame(v("Shree Cement Pvt Ltd"), v("SHREE CEMENT")), "same-name");
assert.equal(whySame(v("Shree Cement"), v("Shre Cement")), "typo");
assert.equal(whySame(v("Jaquar Sanitary"), v("Jaquar Sanitary Depot")), "contains");
assert.equal(whySame(v("Mehta Steel"), v("Shree Cement")), null);
assert.equal(whySame(v("Sunrise Electricals"), v("Sunset Electricals")), null, "a different word is a different company (distance 2 on a short name is not a typo)");
assert.equal(whySame(v("ABC"), v("ABD")), null, "very short names are not guessed at");
assert.equal(whySame(v("Pvt Ltd"), v("Pvt Limited")), null, "nothing left to compare");
assert.equal(whySame(v("Steel"), v("Steel Traders")), null, "a single shared word is not enough for 'part of the other'");
assert.equal(whySame(v("Shree Cement", "27AAAAA0000A1Z5"), v("Shree Cement", "29BBBBB1111B1Z6")), null, "different GSTINs are never suggested");
assert.equal(whySame(v("Shree Cement", "27AAAAA0000A1Z5"), v("Shree Cement Ltd", "27aaaaa0000a1z5")), "same-name", "the same GSTIN in another letter case is fine");
assert.equal(whySame(v("Shree Cement", "27AAAAA0000A1Z5"), v("Shree Cement Ltd")), "same-name", "one without a GSTIN can match one with");

// ---- groups
const a = v("Shree Cement Traders", "27AABCS1234F1Z5", 5);
const b = v("SHREE CEMENT TRADERS PVT LTD", null, 2);
const c = v("Shree Cement Trader", null, 1);
const d1 = v("Jaquar Sanitary Depot", "27AABCJ5678K1Z2", 4);
const e = v("Mehta Steel & Hardware", "24AAACM9012L1Z8", 3);
const f = v("Mehta Steel and Hardware", null, 1);
const loner = v("Sunrise Electricals", "29AABCS3456P1Z1", 2);
const groups = findDuplicateGroups([loner, a, d1, b, e, c, f]);
assert.equal(groups.length, 2);
assert.deepEqual(groups[0].vendors.map((x) => x.id).sort(), [a.id, b.id, c.id].sort(), "three spellings of one supplier form one group");
assert.equal(groups[0].keepId, a.id, "the one with a GSTIN is the default keeper");
assert.ok(groups[0].reasons.includes("same-name") && groups[0].reasons.includes("typo"));
assert.deepEqual(groups[1].vendors.map((x) => x.id).sort(), [e.id, f.id].sort());
assert.equal(groups[1].keepId, e.id);
assert.ok(!groups.some((g) => g.vendors.some((x) => x.id === loner.id || x.id === d1.id)), "others are left alone");
assert.deepEqual(findDuplicateGroups([]), []);
assert.deepEqual(findDuplicateGroups([a]), []);
// default keeper without any GSTIN: the one with more invoices
const p = v("Local Sand Supplier", null, 1);
const q = v("Local Sand Suppliers", null, 7);
assert.equal(findDuplicateGroups([p, q])[0].keepId, q.id);
// a chain still forms one group even when the ends are not similar
const t1 = v("Ganesh Building Material", null, 1);
const t2 = v("Ganesh Building Materials", null, 1);
const t3 = v("Ganesh Building Materials Supply", null, 1);
assert.equal(findDuplicateGroups([t1, t2, t3]).length, 1);
assert.equal(findDuplicateGroups([t1, t2, t3])[0].vendors.length, 3);

// ---- what blocks a merge
assert.equal(mergeProblem({ gstin: null }, { gstin: "27AAAAA0000A1Z5" }, ["A-1"], ["B-1"]), null);
assert.equal(mergeProblem({ gstin: "27AAAAA0000A1Z5" }, { gstin: "27aaaaa0000a1z5" }, ["A-1"], ["B-1"]), null, "same GSTIN, other letter case");
assert.match(mergeProblem({ gstin: "27AAAAA0000A1Z5" }, { gstin: "29BBBBB1111B1Z6" }, [], [])!, /different GSTINs/);
assert.match(mergeProblem({ gstin: null }, { gstin: null }, ["INV-1", "INV-2"], ["inv-2", "INV-9"])!, /numbered INV-2/);
assert.match(mergeProblem({ gstin: null }, { gstin: null }, ["1", "2", "3", "4", "5", "6", "7"], ["1", "2", "3", "4", "5", "6", "7"])!, /and more/);
assert.equal(mergeProblem({ gstin: null }, { gstin: null }, [], []), null);

console.log("vendor duplicates: all checks passed");
