// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { checkDocumentFile, currentRevision, DOCUMENT_MAX_BYTES, extensionOf, humanSize, nextRevisionLabel, parseDocument, parseRevisionLabel, safeFileName, servingHeaders } from "./document-rules";
import { DOC_LINK_SECONDS, signDocLink, verifyDocLink } from "./doc-links";

const bytes = (...parts: (string | number[])[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));
const pad = (n: number) => new Array(n).fill(0);

// ---- file names
assert.equal(extensionOf("S-101 Foundation.PDF"), "pdf");
assert.equal(extensionOf("noext"), "");
assert.equal(extensionOf("a.b.dwg"), "dwg");
assert.equal(safeFileName("C:\\drawings\\S 101 <v2>.pdf"), "S 101 _v2_.pdf");
assert.equal(safeFileName("../../etc/passwd"), "passwd");
assert.equal(safeFileName("...hidden"), "hidden");
assert.equal(safeFileName(""), "file");
assert.ok(safeFileName("x".repeat(300) + ".pdf").length <= 120);

// ---- formats: bytes AND name must agree
const pdf = bytes("%PDF-1.7\n", pad(20));
const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0], pad(20));
const png = bytes([0x89], "PNG\r\n", [0x1a, 0x0a], pad(20));
const webp = bytes("RIFF", [1, 2, 3, 4], "WEBP", pad(8));
const dwg = bytes("AC1032", pad(30));
const dxf = bytes("  0\nSECTION\n  2\nHEADER\n", pad(10));
const dxfComment = bytes("999\nmade by a tool\n0\r\nSECTION\r\n2\r\nHEADER", pad(10));
const zipOffice = (part: string) => bytes([0x50, 0x4b, 0x03, 0x04], pad(26), "[Content_Types].xml", pad(10), part);
const ok = (head: Uint8Array, name: string) => checkDocumentFile(head, 1000, name);

for (const [head, name, ext] of [[pdf, "a.pdf", "pdf"], [jpeg, "a.jpg", "jpg"], [jpeg, "a.JPEG", "jpg"], [png, "a.png", "png"], [webp, "a.webp", "webp"], [dwg, "plan.dwg", "dwg"], [dxf, "plan.dxf", "dxf"], [dxfComment, "plan.dxf", "dxf"],
  [zipOffice("word/document.xml"), "spec.docx", "docx"], [zipOffice("xl/workbook.xml"), "boq.xlsx", "xlsx"], [zipOffice("ppt/slides"), "deck.pptx", "pptx"]] as [Uint8Array, string, string][]) {
  const r = ok(head, name);
  assert.ok(r.ok && r.format.ext === ext, name);
}
assert.equal(ok(pdf, "a.pdf").ok && (ok(pdf, "a.pdf") as { format: { inline: boolean } }).format.inline, true, "pdf opens in the page");
assert.equal((ok(dwg, "a.dwg") as { format: { inline: boolean } }).format.inline, false, "dwg downloads");

// a renamed file, a wrong extension, a script, an unknown type, an empty or huge file
assert.ok(!ok(bytes("<html><script>alert(1)</script>"), "a.pdf").ok, "a web page renamed .pdf");
assert.ok(!ok(pdf, "a.jpg").ok, "a pdf named .jpg");
assert.ok(!ok(pdf, "a.exe").ok, "an unknown type");
assert.ok(!ok(pdf, "noextension").ok);
assert.ok(!ok(bytes("MZ", pad(20)), "tool.dwg").ok, "a program renamed .dwg");
assert.ok(!ok(bytes([0x50, 0x4b, 0x03, 0x04], pad(40)), "a.docx").ok, "a zip that is not an Office file");
assert.ok(!ok(dxf, "a.dwg").ok);
assert.ok(!checkDocumentFile(pdf, 0, "a.pdf").ok);
assert.ok(!checkDocumentFile(pdf, DOCUMENT_MAX_BYTES + 1, "a.pdf").ok);
assert.ok(checkDocumentFile(pdf, DOCUMENT_MAX_BYTES, "a.pdf").ok);
assert.ok(!ok(new Uint8Array(), "a.pdf").ok);

// ---- serving headers
const h = servingHeaders({ ext: "dwg", contentType: "application/acad", label: "x", inline: false }, 'bad"name.dwg');
assert.match(h["Content-Disposition"], /^attachment; filename="bad_name\.dwg"$/);
assert.equal(h["X-Content-Type-Options"], "nosniff");
assert.match(h["Content-Security-Policy"], /sandbox/);
assert.match(servingHeaders({ ext: "pdf", contentType: "application/pdf", label: "PDF", inline: true }, "a.pdf")["Content-Disposition"], /^inline;/);

// ---- revisions
for (const v of ["A", "r2", "01", "1.2", " B "]) assert.ok(parseRevisionLabel(v).ok, v);
assert.deepEqual(parseRevisionLabel("r2"), { ok: true, value: "R2" });
for (const v of ["", "   ", "x".repeat(13), "-A", "A B", "A/B", "<b>"]) assert.ok(!parseRevisionLabel(v).ok, JSON.stringify(v));
assert.equal(nextRevisionLabel(null), "A");
assert.equal(nextRevisionLabel("A"), "B");
assert.equal(nextRevisionLabel("Z"), "AA");
assert.equal(nextRevisionLabel("R2"), "R3");
assert.equal(nextRevisionLabel("09"), "10");
assert.equal(nextRevisionLabel("0"), "1");
assert.equal(nextRevisionLabel("FINAL"), "FINAL-2");
const revs = [{ id: "1", revision: "A", createdAt: "2026-01-01T00:00:00Z" }, { id: "3", revision: "C", createdAt: "2026-03-01T00:00:00Z" }, { id: "2", revision: "B", createdAt: new Date("2026-02-01T00:00:00Z") }];
assert.equal(currentRevision(revs)?.id, "3", "the one added last");
assert.equal(currentRevision([]), null);

// ---- details
const TODAY = "2026-10-27";
const good = { title: "Foundation plan", number: " s-101 ", category: "STRUCTURAL", revision: "a", issuedOn: "2026-10-01" };
const d = parseDocument(good, TODAY);
assert.ok(d.ok && d.value.number === "S-101" && d.value.revision === "A" && d.value.category === "STRUCTURAL" && d.value.note === null);
assert.ok(parseDocument({ ...good, number: "" }, TODAY).ok && (parseDocument({ ...good, number: "" }, TODAY) as { value: { number: null } }).value.number === null, "the number is optional");
assert.ok(!parseDocument({ ...good, title: "ab" }, TODAY).ok);
assert.ok(!parseDocument({ ...good, category: "SECRET" }, TODAY).ok);
assert.ok(!parseDocument({ ...good, category: undefined }, TODAY).ok);
assert.ok(!parseDocument({ ...good, issuedOn: "2026-11-01" }, TODAY).ok, "future");
assert.ok(!parseDocument({ ...good, issuedOn: "2026-13-01" }, TODAY).ok);
assert.ok(parseDocument({ ...good, issuedOn: "" }, TODAY).ok, "defaults to today");
assert.ok(!parseDocument({ ...good, number: "x".repeat(41) }, TODAY).ok);
assert.ok(!parseDocument({ ...good, note: "x".repeat(501) }, TODAY).ok);
assert.ok(!parseDocument({ ...good, revision: "" }, TODAY).ok);
assert.ok(parseDocument({ revision: "B", note: "Beam sizes changed", issuedOn: "2026-10-02" }, TODAY, { forNewDocument: false }).ok, "a new revision needs no title or category");
assert.ok(!parseDocument(null, TODAY).ok);

assert.equal(humanSize(500), "500 B");
assert.equal(humanSize(2048), "2 KB");
assert.equal(humanSize(5 * 1024 * 1024), "5.0 MB");

// ---- phone download links
process.env.AUTH_SECRET = "doc-link-test-secret";
const now = new Date("2026-10-27T10:00:00Z");
const link = signDocLink({ revisionId: "rev1", userId: "u1", orgId: "o1" }, now);
assert.deepEqual(verifyDocLink(link, now), { revisionId: "rev1", userId: "u1", orgId: "o1" });
assert.ok(verifyDocLink(link, new Date(+now + (DOC_LINK_SECONDS - 1) * 1000)), "valid for five minutes");
assert.equal(verifyDocLink(link, new Date(+now + DOC_LINK_SECONDS * 1000)), null, "then it stops working");
const [payload, sig] = link.split(".");
const forged = Buffer.from(JSON.stringify({ r: "rev2", u: "u1", o: "o1", e: Math.floor(+now / 1000) + 300 })).toString("base64url");
assert.equal(verifyDocLink(`${forged}.${sig}`, now), null, "another file cannot reuse the signature");
assert.equal(verifyDocLink(`${payload}.${sig.slice(0, -2)}AA`, now), null);
assert.equal(verifyDocLink(`${payload}.${sig}.x`, now), null);
for (const bad of ["", "abc", "a.b", ".", "x".repeat(700)]) assert.equal(verifyDocLink(bad, now), null);
const keep = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "another-secret";
assert.equal(verifyDocLink(link, now), null, "signed with a different secret");
process.env.AUTH_SECRET = keep;
delete process.env.AUTH_SECRET;
delete process.env.MOBILE_TOKEN_SECRET;
assert.throws(() => signDocLink({ revisionId: "r", userId: "u", orgId: "o" }, now));
assert.equal(verifyDocLink(link, now), null);

console.log("document rules: all checks passed");
