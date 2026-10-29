import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { parsePcExpressMail, pcExpressLocalDate, PcExpressMailError, PC_EXPRESS_GMAIL_QUERY } from "../apps/worker/dist/pc-express-mail.js";
import { GroceryStore, validateSource } from "../apps/worker/dist/grocery-store.js";
import { GroceryCollection } from "../apps/worker/dist/grocery-collection.js";

const order = "531900000000001";
const confirmationSubject = "\u202fVotre commande avec livraison est confirmée ✅";
const deliveredSubject = "Votre commande a été livrée! 🎉";
const cells = values => `<tr>${values.map(value => `<td><p>${value}</p></td>`).join("")}</tr>`;
const productTable = rows => `<!-- PRODUCT DETAILS STARTS --><table><tr><td><!--[if mso]><table><![endif]--><table>${cells(["Nom du produit", "Qté", "Prix unitaire", "Prix total"])}${rows.map(cells).join("")}</table><!--[if mso]></table><![endif]--></td></tr></table><!-- PRODUCT DETAILS ENDS -->`;
const items = [["Synthetic oats &amp; grain", "2", "3,00&nbsp;$", "0,00\n&nbsp;$"], ["Synthetic soap", "1", "4,00 $", "0,00 $"]];
const confirm = (rows = items) => `<html><head><style>.hidden { color: red }</style></head><body><p>Nᵒ de commande ${order}</p><p>Bonjour Sample, votre commande est confirmée!</p><p>Private delivery address omitted by the parser</p><p>Visa se terminant par 1111</p><p>Détails de la commande</p><p>Sous-total</p><p>10,00 $</p><p>Frais de service</p><p>GRATUIT</p><p>Frais supplémentaires</p><p>0,25 $</p><p>GST</p><p>0,50 $</p><p>PST</p><p>0,70 $</p><p>Total estimé</p><p>11,45 $</p><p>Carte de paiement autorisé</p><p>14,31 $</p>${productTable(rows)}<a href="https://example.invalid/private-token">Voir la commande</a></body></html>`;
const delivered = () => `<html><body><p>Nᵒ de commande ${order}</p><p>Bonjour Sample, votre commande a été livrée!</p><p>Vous pouvez consulter les détails de votre commande en ligne en tout temps.</p></body></html>`;
const raw = (html = confirm(), subject = confirmationSubject) => ({ id: "abcd12345678", threadId: "abcd12345678", internalDate: String(Date.parse("2026-10-05T00:01:00.000Z")), snippet: "Untrusted truncated snippet",
  payload: { mimeType: "text/html", headers: [{ name: "From", value: "PC Express <noreply@t.pcexpress.ca>" }, { name: "Subject", value: subject }], body: { size: Buffer.byteLength(html), data: Buffer.from(html).toString("base64url") } } });
const parse = mail => parsePcExpressMail(mail, "synthetic-account");
const rejects = (mail, code) => assert.throws(() => parse(mail), error => error instanceof PcExpressMailError && (!code || error.code === code));

test("observed French confirmation preserves estimates, complete rows and privacy", () => {
  const result = parse(raw());
  assert.equal(result.kind, "confirmation"); assert.equal(result.orderId, order); assert.equal(result.receipt.sourceType, "confirmation");
  assert.equal(result.receipt.date, "2026-10-04"); assert.equal(result.receivedAt, "2026-10-05T00:01:00.000Z");
  assert.equal(result.receipt.total, 11.45); assert.equal(result.receipt.tax, 1.2); assert.equal(result.receipt.service, 0); assert.equal(result.receipt.delivery, null);
  assert.deepEqual(result.receipt.items.map(p => [p.name, p.quantity, p.amount, p.size, p.unit, p.uncertain]), [["Synthetic oats & grain", 2, null, null, null, true], ["Synthetic soap", 1, null, null, null, true]]);
  const source = Buffer.from(result.source.data, "base64").toString("utf8");
  assert.match(source, /Structured Gmail excerpt/); assert.match(source, /"finalTotal": null/);
  for (const privateText of ["Private delivery address", "1111", "private-token", "<html", "Sample", "14.31"]) assert.equal(source.includes(privateText), false);
  assert.equal(result.source.hash, createHash("sha256").update(Buffer.from(result.source.data, "base64")).digest("hex"));
  assert.deepEqual(validateSource(result.source), result.source);
  assert.equal(parse(raw()).source.hash, result.source.hash);
});

test("delivery is separate evidence, with Pacific receipt date and no inferred final receipt", () => {
  const result = parse(raw(delivered(), deliveredSubject));
  assert.equal(result.kind, "delivered"); assert.equal(result.receipt, undefined);
  assert.equal(JSON.parse(Buffer.from(result.source.data, "base64")).deliveryDate, "2026-10-04");
  assert.equal(pcExpressLocalDate("2026-10-05T07:01:00.000Z"), "2026-10-05");
  assert.equal(pcExpressLocalDate("2026-12-05T06:01:00.000Z"), "2026-12-04");
  assert.throws(() => pcExpressLocalDate("2026-02-30T00:00:00.000Z"), PcExpressMailError);
});

test("only explicit first-party product links preserve a SKU; ambiguous links or matching names never invent one", () => {
  const source = confirm();
  const linked = source.replace("Synthetic oats &amp; grain", '<a href="https://www.realcanadiansuperstore.ca/en/synthetic/p/12345678_EA">Synthetic oats &amp; grain</a>');
  assert.ok(linked !== source);
  assert.deepEqual(parse(raw(linked)).receipt.items[0].productReference, { provider: "pcexpress", id: "12345678_EA" });
  assert.equal(parse(raw()).receipt.items[0].productReference, undefined);
  assert.equal(parse(raw(linked.replace("www.realcanadiansuperstore.ca", "untrusted.example"))).receipt.items[0].productReference, undefined);
  const ambiguous = linked.replace("</a>", '</a><a href="https://www.realcanadiansuperstore.ca/en/other/p/87654321_EA"></a>');
  assert.equal(parse(raw(ambiguous)).receipt.items[0].productReference, undefined);
});

test("sender and observed subject gates ignore unrelated, picked, en route, forwarded and English mail", () => {
  for (const subject of ["Your order has been picked!", "Votre commande est en route! 🙌", "Fwd: " + confirmationSubject, "Your delivery order is confirmed"]) assert.equal(parse(raw(confirm(), subject)), null);
  const mail = raw(); mail.payload.headers[0].value = "PC Express <noreply@t.pcexpress.ca.attacker.invalid>"; assert.equal(parse(mail), null);
  assert.match(PC_EXPRESS_GMAIL_QUERY, /^from:noreply@t\.pcexpress\.ca /);
  const duplicate = raw(); duplicate.payload.headers.push({ name: "From", value: "other@example.invalid" }); rejects(duplicate, "ambiguous-sender");
});

test("query-matching transactional subject variants require review rather than silently becoming seen", () => {
  for (const subject of ["Votre commande avec livraison est confirmée", "Votre commande avec livraison est confirmée!", "Votre commande a été livrée!", "Votre commande a été livrée! ✅"]) {
    rejects(raw(confirm(), subject), "unsupported-transaction-subject");
  }
});

test("requires real immutable message identity and received timestamp, never snippet or now", () => {
  for (const value of [undefined, "", "garbage", "1791168060"]) { const mail = raw(); mail.internalDate = value; rejects(mail, "missing-source-date"); }
  const mail = raw(); delete mail.payload.body.data; rejects(mail, "incomplete-html");
  const id = raw(); id.id = "not-a-gmail-id"; rejects(id, "invalid-source-identity");
});

test("bounded full MIME handles multipart alternative and content after 12k characters", () => {
  const html = confirm().replace("<body>", "<body>" + " ".repeat(20_000));
  const mail = raw(html); const body = { ...mail.payload }; delete body.headers;
  mail.payload = { mimeType: "multipart/alternative", headers: mail.payload.headers, parts: [{ mimeType: "text/plain", body: { size: 9, data: Buffer.from("truncated").toString("base64url") } }, body] };
  assert.equal(parse(mail).receipt.items.length, 2);
  const twice = structuredClone(mail); twice.payload.parts.push(body); rejects(twice, "incomplete-html");
  const missing = raw(); missing.payload.body.size += 1; rejects(missing, "incomplete-mime-body");
  const oversized = raw(confirm().replace("<body>", "<body>" + " ".repeat(1_000_001))); rejects(oversized, "invalid-encoding");
  const attachment = raw(); attachment.payload.parts = [{ filename: "unexpected.pdf", body: { attachmentId: "synthetic" } }]; rejects(attachment, "unsupported-mime");
});

test("truncated or ambiguous sources stop rather than persisting a partial receipt", () => {
  rejects(raw(confirm().replace("</html>", "")), "incomplete-html");
  rejects(raw(confirm().replace("<!-- PRODUCT DETAILS ENDS -->", "")), "unsupported-product-layout");
  rejects(raw(confirm().replace("<p>Détails de la commande</p>", `<p>Nᵒ de commande 531900000000002</p>`)), "ambiguous-order");
  rejects(raw(confirm().replace("Total estimé", "Montant final")), "unsupported-confirmation-layout");
  rejects(raw(confirm().replace("<p>Total estimé</p>", "<p>Total estimé</p><p>11,45 $</p><p>Total estimé</p>")), "invalid-summary");
  rejects(raw(confirm().replace("<p>11,45 $</p>", "<p>14,31 $</p>")), "inconsistent-estimates");
  rejects(raw(confirm([items[0]])), "inconsistent-estimates");
  rejects(raw(confirm([["Synthetic oats", "2 kg", "3,00 $", "0,00 $"]])), "invalid-product-row");
  rejects(raw(confirm([["Synthetic oats", "2", "3,00 $/kg", "0,00 $"]])), "invalid-money");
});

test("nonzero printed line estimates remain distinct from amounts paid", () => {
  const rows = structuredClone(items); rows[0][3] = "6,00 $";
  const result = parse(raw(confirm(rows)));
  assert.equal(result.receipt.items[0].amount, null); assert.match(result.receipt.items[0].evidence, /imprimé 6\.00 CAD/);
  rows[0][3] = "5,00 $"; rejects(raw(confirm(rows)), "inconsistent-line-estimate");
});

test("subject alone never proves delivery", () => {
  rejects(raw(delivered().replace("votre commande a été livrée!", "votre commande sera livrée!"), deliveredSubject), "unsupported-delivery-layout");
});

test("full synthetic MIME travels through the real parser, collector and durable store without replay", async t => {
  const directory = await mkdtemp(join(tmpdir(), "familyhub-pc-express-full-path-"));
  t.after(async () => {
    const target = resolve(directory), allowed = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(allowed) && basename(target).startsWith("familyhub-pc-express-full-path-"));
    await rm(target, { recursive: true, force: true });
  });
  const confirmation = raw();
  const delivery = raw(delivered(), deliveredSubject); delivery.id = "abcd12345679"; delivery.threadId = delivery.id;
  delivery.internalDate = String(Date.parse("2026-10-05T01:00:00.000Z"));
  const messages = new Map([[confirmation.id, confirmation], [delivery.id, delivery]]), requests = [];
  const store = new GroceryStore(directory, async () => { throw new Error("Extractor must not run"); });
  const dependencies = {
    credentials: async () => ({ accounts: [{ email: "synthetic@example.test", label: "Synthetic", clientId: "unused", clientSecret: "unused", refreshToken: "unused" }] }),
    accessToken: async () => "synthetic-no-network-token",
    gmail: async (_token, path) => {
      requests.push(path);
      if (path.startsWith("messages?")) return { messages: [...messages.keys()].map(id => ({ id })) };
      const id = decodeURIComponent(path.slice("messages/".length).split("?")[0]);
      assert.ok(messages.has(id)); return messages.get(id);
    },
    now: () => new Date("2026-10-06T12:00:00.000Z"),
  };
  const first = await new GroceryCollection(directory, store, dependencies).collect();
  assert.equal(first.incomplete, false); assert.equal(first.counts.imported, 1); assert.equal(first.accounts[0].pendingMessages, 0);
  const saved = (await store.list()).records;
  assert.equal(saved.length, 1); assert.equal(saved[0].receipt.sourceType, "confirmation"); assert.equal(saved[0].receipt.total, 11.45);
  assert.equal(saved[0].reviewedAt, null); assert.equal(saved[0].sources.length, 2); assert.equal(saved[0].receipt.fulfillment.date, "2026-10-04");
  assert.ok(saved[0].receipt.items.every(item => item.amount === null));
  const before = await readFile(join(directory, "purchases.json"));
  const second = await new GroceryCollection(directory, new GroceryStore(directory, async () => { throw new Error("Extractor must not run"); }), dependencies).collect();
  assert.equal(second.incomplete, false); assert.equal(second.counts.imported, 0);
  assert.equal(second.lastImportedAt, first.lastImportedAt);
  assert.equal(requests.filter(path => path.endsWith("?format=full")).length, 2);
  assert.deepEqual(await readFile(join(directory, "purchases.json")), before);
  assert.doesNotMatch(before.toString("utf8"), /private-token|Private delivery address|1111|<html/);
  for (const source of saved[0].sources) {
    const stored = await store.source(saved[0].id, source.hash);
    assert.doesNotMatch(Buffer.from(stored.data, "base64").toString("utf8"), /private-token|Private delivery address|1111|<html/);
  }
});
