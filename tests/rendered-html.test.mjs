import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("uses Supabase for protected, versioned financial storage", async () => {
  const [server, receiptRoute, payoutRoute, rulesRoute, migration, rulesMigration] = await Promise.all([
    readFile(new URL("../lib/villix-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/receipts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payouts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rules/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260831122500_villix_foundation.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260831152000_versioned_contribution_rules.sql", import.meta.url), "utf8"),
  ]);
  assert.match(server, /requireAdmin/);
  assert.match(receiptRoute, /receipt-files/);
  assert.match(receiptRoute, /SHA-256/);
  assert.match(payoutRoute, /calculationHash/);
  assert.match(payoutRoute, /entry\.payout_cents/);
  assert.match(payoutRoute, /rule_version/);
  assert.match(rulesRoute, /publish_rule_version/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /payout_batches/);
  assert.match(rulesMigration, /Published rule versions are immutable/);
  assert.match(rulesMigration, /enable row level security/i);
});

test("contains no deployment dependency on the previous platform", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.dependencies.next, "16.3.3");
  assert.ok(packageJson.dependencies["@supabase/ssr"]);
  assert.equal(packageJson.dependencies.vinext, undefined);
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
});

test("parses, reviews, and validates receipt PDFs on the trusted server", async () => {
  const [managerApp, receiptRoute, receiptParser, receiptReview, nextConfig] = await Promise.all([
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/receipts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/receipt-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/receipt-review.ts", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(managerApp, /pdfjs-dist|GlobalWorkerOptions/);
  assert.match(receiptRoute, /parseReceiptPdf\(buffer\)/);
  assert.match(receiptRoute, /runtime = "nodejs"/);
  assert.match(receiptParser, /sourceTotalCents !== extractedTotalCents/);
  assert.match(receiptParser, /new Uint8Array\(buffer\)\.slice\(\)/);
  assert.ok(receiptParser.includes("Member\\s+Type\\s+Amount"));
  assert.match(receiptRoute, /contribution_entries"\)\.delete\(\)\.eq\("receipt_id", receiptId\)/);
  assert.match(receiptRoute, /action === "resolve_handle"/);
  assert.match(receiptRoute, /export async function DELETE/);
  assert.match(receiptRoute, /Approved receipts are locked and cannot be deleted/);
  assert.match(receiptRoute, /receipt-files"\)\.remove/);
  assert.match(receiptReview, /Unmatched handle/);
  assert.match(receiptReview, /nextStatus = issues\.size \? "review" : "verified"/);
  assert.match(managerApp, /Create and match/);
  assert.match(managerApp, /Confirm delete/);
  assert.match(nextConfig, /serverExternalPackages: \["pdfjs-dist"\]/);
  assert.match(nextConfig, /outputFileTracingIncludes/);
  assert.match(nextConfig, /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs/);
  await access(new URL("../.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url));
});

test("provides person performance profiles and protects financial history on removal", async () => {
  const [managerApp, peopleRoute, stateRoute] = await Promise.all([
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/people/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(managerApp, /function PersonProfileModal/);
  assert.match(managerApp, /Gross contributed/);
  assert.match(managerApp, /Recent submissions/);
  assert.match(managerApp, /money\.format\(values\.gross\)/);
  assert.match(managerApp, /money\.format\(values\.payable\).*payable/);
  assert.match(managerApp, /Team payable routed/);
  assert.match(managerApp, /Statistics include verified and approved receipt entries/);
  assert.match(managerApp, /Confirm removal/);
  assert.match(managerApp, /Edit person details/);
  assert.match(managerApp, /Save changes/);
  assert.match(managerApp, /entry\.personId === person\.id/);
  assert.match(peopleRoute, /export async function DELETE/);
  assert.match(peopleRoute, /Reviewers cannot update people/);
  assert.match(peopleRoute, /display_name: name, email, handle/);
  assert.match(peopleRoute, /receipt handle or email is already in use/);
  assert.match(peopleRoute, /contribution_entries/);
  assert.match(peopleRoute, /payout_recipients/);
  assert.match(peopleRoute, /cannot be removed because/);
  assert.match(stateRoute, /personId: entry\.contributor_id/);
});

test("shows receipt breakdowns and enforces the weekly payout schedule", async () => {
  const [managerApp, stateRoute, payoutRoute, settingsRoute, schedule] = await Promise.all([
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payouts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/payout-schedule.ts", import.meta.url), "utf8"),
  ]);
  assert.match(managerApp, /function ReceiptDetailModal/);
  assert.match(managerApp, /Receipt breakdown/);
  assert.match(managerApp, /Villix keeps/);
  assert.match(managerApp, /Tap to view full breakdown/);
  assert.match(managerApp, /Scheduled automatically/);
  assert.doesNotMatch(managerApp, /Choose this week’s payout date/);
  assert.doesNotMatch(managerApp, /Payout date<input type="date"/);
  assert.match(stateRoute, /receiptEntries/);
  assert.match(payoutRoute, /scheduledPayoutDate\(periodEnd, payoutDay\)/);
  assert.match(payoutRoute, /workspace_settings/);
  assert.match(settingsRoute, /Reviewers cannot change payout settings/);
  assert.match(settingsRoute, /payout_policy/);
  assert.match(schedule, /scheduledPayoutDate/);
  assert.match(schedule, /label: "Aug 24 – Aug 30"/);
});
