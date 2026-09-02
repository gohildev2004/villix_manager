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
  const [managerApp, receiptRoute, receiptParser, receiptText, receiptReview, nextConfig] = await Promise.all([
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/receipts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/receipt-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/receipt-text.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/receipt-review.ts", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(managerApp, /pdfjs-dist|GlobalWorkerOptions/);
  assert.match(receiptRoute, /parseReceiptPdf\(buffer\)/);
  assert.match(receiptRoute, /runtime = "nodejs"/);
  assert.match(receiptParser, /parseReceiptText\(text\)/);
  assert.match(receiptText, /sourceTotalCents !== extractedTotalCents/);
  assert.match(receiptParser, /new Uint8Array\(buffer\)\.slice\(\)/);
  assert.ok(receiptText.includes("Member\\s+Type\\s+Amount"));
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

test("ships isolated staging, CI, behavioral rules, and private operational monitoring", async () => {
  const [workflow, staging, behavior, monitoring, readiness, managerApp, render, ownerProtection] = await Promise.all([
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../render.staging.yaml", import.meta.url), "utf8"),
    readFile(new URL("./behavioral-rules.test.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/monitoring/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/ready/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260902005343_protect_initial_owners.sql", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /npm run test:behavior/);
  assert.match(workflow, /npm run build/);
  assert.match(staging, /villix-manager-staging/);
  assert.match(staging, /EMAIL_OTP_ENABLED[\s\S]*"true"/);
  assert.match(staging, /PAYOUTS_LIVE_ENABLED[\s\S]*"false"/);
  assert.match(behavior, /historical team assignment/);
  assert.match(behavior, /retains bonus contributions/);
  assert.match(monitoring, /requireAdmin/);
  assert.match(readiness, /workspace_settings/);
  assert.match(managerApp, /System health/);
  assert.match(managerApp, /view === "health" && <SystemHealth/);
  assert.match(managerApp, /monitoring\.checks\.some\(\(check\) => check\.status !== "healthy"\)/);
  assert.match(managerApp, /View system health/);
  assert.match(managerApp, /How to fix this/);
  assert.match(managerApp, /Run checks again/);
  assert.match(managerApp, /healthRunbooks/);
  assert.match(managerApp, /retrying prematurely could create duplicate payment attempts/);
  assert.match(render, /healthCheckPath: \/api\/health\/ready/);
  assert.match(ownerProtection, /alter table private\.initial_owners enable row level security/i);
  assert.match(ownerProtection, /intentionally has no client policies/i);
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

test("locks INR payout snapshots and dispatches only ready recipients", async () => {
  const [managerApp, payoutRoute, dispatchRoute, stateRoute, provider, migration, holdMigration, renderConfig] = await Promise.all([
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payouts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payouts/dispatch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/razorpayx.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260901015829_multi_currency_payout_snapshots.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260902013603_recipient_level_payout_holds.sql", import.meta.url), "utf8"),
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
  ]);
  assert.match(managerApp, /INR settlement/);
  assert.match(managerApp, /No assumed fee/);
  assert.match(managerApp, /Every Villix payable and bank transfer remains in INR/);
  assert.match(managerApp, /table-total payout-table-total/);
  assert.match(managerApp, /totals\.retained \* effectiveRate/);
  assert.doesNotMatch(managerApp, /Payout currency<select/);
  assert.match(managerApp, /Indian bank payouts only/);
  assert.match(payoutRoute, /settlementAdjustmentBps/);
  assert.match(payoutRoute, /payout_currency/);
  assert.match(payoutRoute, /payout_amount_minor/);
  assert.match(payoutRoute, /currency: "INR"/);
  assert.match(payoutRoute, /status: "held"/);
  assert.match(payoutRoute, /hold_reason/);
  assert.match(dispatchRoute, /status === "ready"/);
  assert.match(dispatchRoute, /\["ready", "failed"\]/);
  assert.match(dispatchRoute, /attemptNumber/);
  assert.match(dispatchRoute, /on hold until bank setup is complete/);
  assert.match(dispatchRoute, /PAYOUTS_LIVE_ENABLED !== "true"/);
  assert.match(dispatchRoute, /No real transfers can be created/);
  assert.match(stateRoute, /payoutsLive: process\.env\.PAYOUTS_LIVE_ENABLED === "true"/);
  assert.match(managerApp, /Test mode/);
  assert.match(managerApp, /Payouts are locked in test mode/);
  assert.doesNotMatch(managerApp, /aria-label="Search"/);
  assert.doesNotMatch(managerApp, /aria-label="Notifications"/);
  assert.match(renderConfig, /PAYOUTS_LIVE_ENABLED/);
  assert.match(renderConfig, /value: "false"/);
  assert.match(provider, /X-Payout-Idempotency/);
  assert.match(provider, /queue_if_low_balance: false/);
  assert.match(migration, /payout_fx_rate/);
  assert.match(migration, /total_payable_settlement_cents/);
  assert.match(holdMigration, /'ready', 'held', 'processing', 'paid', 'failed', 'cancelled'/);
  assert.match(holdMigration, /hold_reason/);
  assert.match(holdMigration, /idx_payout_recipients_batch_outstanding/);
  assert.match(stateRoute, /item\.status === "held" \? "On hold"/);
  assert.match(managerApp, /Ready recipients can still be paid/);
  assert.match(managerApp, /Retry failed/);
});

test("prepares a restricted payee portal, hosted onboarding handoff, and payout reconciliation", async () => {
  const [managerApp, payeeRoute, portalAccessRoute, payeePage, payeeServer, webhookRoute, syncRoute, provider, reconciliation, migration, portalMigration, renderConfig, proxy, contributorPortal] = await Promise.all([
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payees/razorpayx/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payee-portal/access/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/payee/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/payee-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/webhooks/razorpayx/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payouts/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/razorpayx.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/razorpayx-reconciliation.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260901100000_razorpayx_reconciliation.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260901143000_payee_portal_foundation.sql", import.meta.url), "utf8"),
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/contributor-portal.ts", import.meta.url), "utf8"),
  ]);
  assert.match(managerApp, /Contributor onboarding/);
  assert.match(managerApp, /Email selected/);
  assert.match(managerApp, /request their own OTP/);
  assert.match(managerApp, /Villix never asks an administrator to type a recipient’s account number/);
  assert.doesNotMatch(managerApp, /name="accountNumber"/);
  assert.match(managerApp, /Sync statuses/);
  assert.doesNotMatch(portalAccessRoute, /signInWithOtp/);
  assert.match(portalAccessRoute, /personIds/);
  assert.match(portalAccessRoute, /request their own one-time sign-in code/);
  assert.match(portalAccessRoute, /payee_portal_accounts/);
  assert.match(renderConfig, /https:\/\/contributor\.villix\.in/);
  assert.match(proxy, /isContributorPortalHost/);
  assert.match(proxy, /\["\/", "\/payee"\]/);
  assert.match(proxy, /new NextResponse\("Not found", \{ status: 404/);
  assert.match(contributorPortal, /contributor\.villix\.in/);
  assert.match(payeePage, /RAZORPAYX_VENDOR_PORTAL_ENABLED/);
  assert.match(payeePage, /Continue in RazorpayX/);
  assert.match(payeeServer, /\.eq\("user_id", userData\.user\.id\)/);
  assert.match(payeeServer, /account\.status === "suspended"/);
  assert.match(portalMigration, /enable row level security/i);
  assert.match(portalMigration, /private\.is_villix_admin/);
  assert.match(portalMigration, /revoke all.*anon, authenticated/i);
  assert.match(payeeRoute, /RAZORPAYX_DIRECT_BANK_FORM_ENABLED/);
  assert.match(payeeRoute, /createRazorpayxContact/);
  assert.match(payeeRoute, /createRazorpayxFundAccount/);
  assert.match(payeeRoute, /bank_last4: bankLast4/);
  assert.doesNotMatch(payeeRoute, /account_number:\s*accountNumber/);
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /x-razorpay-signature/);
  assert.match(webhookRoute, /x-razorpay-event-id/);
  assert.match(webhookRoute, /insertError\?\.code === "23505"/);
  assert.match(webhookRoute, /payloadSha256/);
  assert.match(syncRoute, /fetchRazorpayxPayout/);
  assert.match(syncRoute, /reconcileRazorpayxPayout/);
  assert.match(provider, /timingSafeEqual/);
  assert.match(provider, /RAZORPAYX_WEBHOOK_PREVIOUS_SECRET/);
  assert.match(reconciliation, /provider_status_details/);
  assert.match(reconciliation, /status === "paid"/);
  assert.match(migration, /provider_webhook_events/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke insert, update, delete/);
  assert.doesNotMatch(migration, /raw_payload/);
  assert.match(renderConfig, /SUPABASE_SECRET_KEY/);
  assert.match(renderConfig, /RAZORPAYX_WEBHOOK_SECRET/);
  assert.match(renderConfig, /RAZORPAYX_VENDOR_PORTAL_ENABLED/);
  assert.match(renderConfig, /RAZORPAYX_DIRECT_BANK_FORM_ENABLED/);
});
