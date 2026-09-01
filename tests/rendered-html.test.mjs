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

test("parses and validates receipt PDFs on the trusted server", async () => {
  const [managerApp, receiptRoute, receiptParser, nextConfig] = await Promise.all([
    readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/receipts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/receipt-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(managerApp, /pdfjs-dist|GlobalWorkerOptions/);
  assert.match(receiptRoute, /parseReceiptPdf\(buffer\)/);
  assert.match(receiptRoute, /runtime = "nodejs"/);
  assert.match(receiptParser, /sourceTotalCents !== extractedTotalCents/);
  assert.match(receiptParser, /new Uint8Array\(buffer\)\.slice\(\)/);
  assert.match(receiptRoute, /contribution_entries"\)\.delete\(\)\.eq\("receipt_id", receiptId\)/);
  assert.match(nextConfig, /serverExternalPackages: \["pdfjs-dist"\]/);
  assert.match(nextConfig, /outputFileTracingIncludes/);
  assert.match(nextConfig, /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs/);
  await access(new URL("../.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url));
});
