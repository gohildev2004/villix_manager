import assert from "node:assert/strict";
import test from "node:test";
import { calculatePayoutDistribution, settlementAmount } from "../lib/payout-calculation.js";
import { parseReceiptText, ReceiptTextValidationError } from "../lib/receipt-text.js";

test("parses real receipt semantics and reconciles the source total", () => {
  const parsed = parseReceiptText(`
    Villix contribution receipt
    Date: August 29, 2026
    Member Type Amount
    Speed Ishow (@speed_0711) problem $289.00
    Speed Ishow (@speed_0711) bonus $15.00
    Nova Reed (@novareed) problem $335.00
    TOTAL $639.00
  `);

  assert.equal(parsed.receiptDate, "2026-08-29");
  assert.equal(parsed.sourceTotalCents, 63900);
  assert.deepEqual(parsed.rows.map(({ handle, type, gross }) => ({ handle, type, gross })), [
    { handle: "@speed_0711", type: "problem", gross: 289 },
    { handle: "@speed_0711", type: "bonus", gross: 15 },
    { handle: "@novareed", type: "problem", gross: 335 },
  ]);
});

test("rejects a receipt when extracted rows do not equal its printed total", () => {
  assert.throws(() => parseReceiptText(`
    Date: August 29, 2026
    Member Type Amount
    Speed Ishow (@speed_0711) problem $100.00
    TOTAL $101.00
  `), (error) => error instanceof ReceiptTextValidationError && /does not match/.test(error.message));
});

test("pays only problem contributions and retains bonus contributions", () => {
  const result = calculatePayoutDistribution({
    people: [{ id: "speed", display_name: "Speed Ishow", team_lead_id: null }],
    assignments: [],
    entries: [
      { id: "problem", contributor_id: "speed", source_handle: "@speed_0711", type: "problem", gross_cents: 28900, payout_cents: 14450, receipt_date: "2026-08-29" },
      { id: "bonus", contributor_id: "speed", source_handle: "@speed_0711", type: "bonus", gross_cents: 1500, payout_cents: 0, receipt_date: "2026-08-29" },
    ],
  });

  assert.equal(result.totalGrossCents, 30400);
  assert.equal(result.totalPayableCents, 14450);
  assert.equal(result.recipients.length, 1);
  assert.deepEqual(result.recipients[0], {
    personId: "speed",
    routingType: "direct",
    grossCents: 30400,
    payableCents: 14450,
    contributors: [{ name: "Speed Ishow", handle: "@speed_0711", grossCents: 30400, payableCents: 14450 }],
  });
});

test("routes a contributor's entire payable share to their team lead", () => {
  const result = calculatePayoutDistribution({
    people: [
      { id: "lead", display_name: "Dev Gohil", team_lead_id: null },
      { id: "member", display_name: "Nova Reed", team_lead_id: "lead" },
    ],
    assignments: [],
    entries: [{ id: "entry", contributor_id: "member", source_handle: "@novareed", type: "problem", gross_cents: 20000, payout_cents: 10000, receipt_date: "2026-08-29" }],
  });

  assert.equal(result.recipients[0].personId, "lead");
  assert.equal(result.recipients[0].routingType, "team");
  assert.equal(result.recipients[0].payableCents, 10000);
  assert.equal(result.recipients[0].contributors[0].name, "Nova Reed");
});

test("uses the historical team assignment from the contribution date", () => {
  const result = calculatePayoutDistribution({
    people: [
      { id: "old-lead", display_name: "Old Lead", team_lead_id: null },
      { id: "new-lead", display_name: "New Lead", team_lead_id: null },
      { id: "member", display_name: "Member", team_lead_id: "new-lead" },
    ],
    assignments: [
      { contributor_id: "member", team_lead_id: "old-lead", effective_from: "2026-08-01", effective_to: "2026-08-31" },
      { contributor_id: "member", team_lead_id: "new-lead", effective_from: "2026-09-01", effective_to: null },
    ],
    entries: [{ id: "entry", contributor_id: "member", source_handle: "@member", type: "problem", gross_cents: 10000, payout_cents: 5000, receipt_date: "2026-08-29" }],
  });

  assert.equal(result.recipients[0].personId, "old-lead");
});

test("fails closed for unmatched contributors and unknown rules", () => {
  const base = { id: "entry", source_handle: "@missing", type: "problem", gross_cents: 10000, receipt_date: "2026-08-29" };
  assert.throws(() => calculatePayoutDistribution({ people: [], assignments: [], entries: [{ ...base, contributor_id: null, payout_cents: 5000 }] }), /not matched/);
  assert.throws(() => calculatePayoutDistribution({ people: [{ id: "person", display_name: "Person", team_lead_id: null }], assignments: [], entries: [{ ...base, contributor_id: "person", payout_cents: null }] }), /no payable rule/);
});

test("applies a declared settlement adjustment using integer minor units", () => {
  assert.equal(settlementAmount(10000, 95, 0), 950000);
  assert.equal(settlementAmount(10000, 95, 200), 931000);
});
