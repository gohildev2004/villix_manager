import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("uses Supabase for protected financial storage", async () => {
  const [server, receiptRoute, payoutRoute, migration] = await Promise.all([
    readFile(new URL("../lib/villix-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/receipts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payouts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260831122500_villix_foundation.sql", import.meta.url), "utf8"),
  ]);
  assert.match(server, /requireAdmin/);
  assert.match(receiptRoute, /receipt-files/);
  assert.match(receiptRoute, /SHA-256/);
  assert.match(payoutRoute, /calculationHash/);
  assert.match(payoutRoute, /entry\.type === "problem"/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /payout_batches/);
});

test("contains no deployment dependency on the previous platform", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.dependencies.next, "16.3.3");
  assert.ok(packageJson.dependencies["@supabase/ssr"]);
  assert.equal(packageJson.dependencies.vinext, undefined);
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
});
