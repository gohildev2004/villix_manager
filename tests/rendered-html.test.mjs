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

test("configures the bundled PDF.js worker before parsing receipts", async () => {
  const managerApp = await readFile(new URL("../app/ManagerApp.tsx", import.meta.url), "utf8");
  assert.match(managerApp, /ensurePromiseWithResolvers\(\);\s*\n\s*const pdfjs = await import/);
  assert.match(managerApp, /new URL\("pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs", import\.meta\.url\)/);
  assert.match(managerApp, /GlobalWorkerOptions\.workerSrc = pdfWorkerUrl/);
});
