// Tests for the monthly report. Run with `npm test` in backend/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportContent } from "./content.js";
import { renderReportPdf } from "./pdf.js";
import { isDue, parseRecipients, reportSettings } from "./mail.js";
import { sample } from "./fixture.js";


test("report content compares the new month with the previous one", () => {
  const R = buildReportContent(sample(), "2026-11", "nl");
  assert.equal(R.previous.key, "2026-10");
  const kinds = Object.fromEntries(R.changes.map((c) => [c.label, c.kind]));
  assert.equal(kinds.Huur, "changed");
  assert.equal(kinds.Energie, "added");
  assert.equal(kinds.Sportschool, "removed");
  assert.equal(kinds.Telefoon, "added");
  const expenses = R.comparison.find((r) => r.id === "expenses");
  assert.equal(expenses.value, 1120); assert.equal(expenses.previous, 990);
  assert.equal(R.current.log.length, 1);
});

test("report transfers name the pot and flag a missing day", () => {
  const R = buildReportContent(sample(), "2026-11", "nl");
  const raisin = R.current.transfers.rows.find((r) => r.to.startsWith("Raisin"));
  assert.ok(raisin, "transfer to the sub-account");
  assert.match(raisin.purpose, /Buffer/);
  assert.equal(raisin.day, "", "fixed amount without a day");
  assert.equal(raisin.reference, "PLAN123");
});

test("the first month has nothing to look back on", () => {
  const R = buildReportContent(sample(), "2026-10", "en");
  assert.equal(R.previous, null);
  assert.deepEqual(R.changes, []);
});

test("renders a PDF", async () => {
  const pdf = await renderReportPdf(sample(), "2026-11", { lang: "nl", appTitle: "Familie" });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 2000);
});

test("recipients and settings are cleaned up", () => {
  assert.deepEqual(parseRecipients("a@b.nl, c@d.com;  nope, e@f.org"), ["a@b.nl", "c@d.com", "e@f.org"]);
  assert.deepEqual(reportSettings({ report: { enabled: true, recipients: "a@b.nl", day: "31" } }), { enabled: true, recipients: ["a@b.nl"], day: 28 });
  assert.equal(reportSettings({}).enabled, false);
});

test("the report is due once per month, from the chosen day", () => {
  const settings = { enabled: true, recipients: ["a@b.nl"], day: 3 };
  const at = (d) => new Date(`2026-11-${d}T10:00:00Z`);
  assert.equal(isDue(settings, {}, at("02")), null, "before the day");
  assert.equal(isDue(settings, {}, at("03")), "2026-11");
  assert.equal(isDue(settings, {}, at("20")), "2026-11", "a missed day is caught up");
  assert.equal(isDue(settings, { lastSentMonth: "2026-11" }, at("20")), null, "already sent");
  assert.equal(isDue(settings, { lastSentMonth: "2026-10" }, at("03")), "2026-11");
  assert.equal(isDue({ ...settings, enabled: false }, {}, at("03")), null);
  assert.equal(isDue(settings, { lastAttemptMonth: "2026-11", lastAttemptAt: "2026-11-03T09:30:00Z" }, at("03")), null, "a failed try waits an hour");
});
