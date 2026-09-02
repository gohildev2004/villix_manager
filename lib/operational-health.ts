import type { VillixClient } from "@/lib/villix-server";
import { safeJson } from "@/lib/villix-server";
import { invitationEmailConfigured, invitationEmailProvider } from "@/lib/invitation-email";

export type HealthCheckStatus = "healthy" | "warning" | "error";
export type OperationalHealthCheck = { id: string; label: string; status: HealthCheckStatus; detail: string };
export type OperationalHealth = {
  status: HealthCheckStatus;
  environment: string;
  checkedAt: string;
  checks: OperationalHealthCheck[];
  counts: { receiptsNeedingReview: number; stuckPayouts: number; failedTransfers: number; failedWebhooks: number };
  lastWebhookAt: string | null;
};

const minutes = (value: string) => (Date.now() - new Date(value).valueOf()) / 60_000;

export async function collectOperationalHealth(supabase: VillixClient): Promise<OperationalHealth> {
  const [database, storage, webhooks, batches, receipts, attempts] = await Promise.all([
    supabase.from("workspace_settings").select("key").limit(1),
    supabase.storage.from("receipt-files").list("", { limit: 1 }),
    supabase.from("provider_webhook_events").select("status,received_at,error").order("received_at", { ascending: false }).limit(50),
    supabase.from("payout_batches").select("id,status,created_at,payout_date").in("status", ["approved", "processing"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("receipts").select("id,status,issues,created_at").in("status", ["review", "verified"]).order("created_at", { ascending: false }).limit(500),
    supabase.from("payment_attempts").select("id,status,created_at").in("status", ["failed", "processing"]).order("created_at", { ascending: false }).limit(500),
  ]);

  const checks: OperationalHealthCheck[] = [];
  checks.push(database.error
    ? { id: "database", label: "Database", status: "error", detail: "Supabase database could not be reached." }
    : { id: "database", label: "Database", status: "healthy", detail: "Supabase database is responding." });
  checks.push(storage.error
    ? { id: "storage", label: "Receipt storage", status: "error", detail: "The private receipt bucket could not be checked." }
    : { id: "storage", label: "Receipt storage", status: "healthy", detail: "The private receipt bucket is available." });

  const payoutsLive = process.env.PAYOUTS_LIVE_ENABLED === "true";
  const requiredServerConfig = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY];
  const providerConfig = [process.env.RAZORPAYX_KEY_ID, process.env.RAZORPAYX_KEY_SECRET, process.env.RAZORPAYX_ACCOUNT_NUMBER, process.env.RAZORPAYX_WEBHOOK_SECRET];
  const configReady = requiredServerConfig.every(Boolean) && (!payoutsLive || providerConfig.every(Boolean));
  checks.push(configReady
    ? { id: "configuration", label: "Server configuration", status: "healthy", detail: payoutsLive ? "Live payout configuration is present." : "Test mode is locked and server configuration is present." }
    : { id: "configuration", label: "Server configuration", status: "error", detail: "One or more required server-only environment values are missing." });
  checks.push(invitationEmailConfigured()
    ? { id: "invitations", label: "Invitation email", status: "healthy", detail: invitationEmailProvider() === "resend" ? "HTTPS invitation delivery is configured." : "SMTP invitation delivery is configured." }
    : { id: "invitations", label: "Invitation email", status: "warning", detail: "Add a Resend API key or complete the SMTP variables." });

  const receiptRows = receipts.data ?? [];
  const receiptsNeedingReview = receiptRows.filter((receipt) => receipt.status === "review" || safeJson<string[]>(receipt.issues, []).length > 0).length;
  checks.push(receipts.error
    ? { id: "receipts", label: "Receipt queue", status: "error", detail: "Receipt review status could not be checked." }
    : receiptsNeedingReview
      ? { id: "receipts", label: "Receipt queue", status: "warning", detail: `${receiptsNeedingReview} receipt${receiptsNeedingReview === 1 ? " needs" : "s need"} administrator review.` }
      : { id: "receipts", label: "Receipt queue", status: "healthy", detail: "No receipt import issues are waiting." });

  const stuckPayouts = (batches.data ?? []).filter((batch) => batch.status === "processing" && minutes(batch.created_at) > 30).length;
  checks.push(batches.error
    ? { id: "payouts", label: "Payout processing", status: "error", detail: "Payout status could not be checked." }
    : stuckPayouts
      ? { id: "payouts", label: "Payout processing", status: "warning", detail: `${stuckPayouts} payout batch${stuckPayouts === 1 ? " has" : "es have"} been processing for over 30 minutes.` }
      : { id: "payouts", label: "Payout processing", status: "healthy", detail: "No payout batch appears stuck." });

  const attemptRows = attempts.data ?? [];
  const failedTransfers = attemptRows.filter((attempt) => attempt.status === "failed").length;
  const staleAttempts = attemptRows.filter((attempt) => attempt.status === "processing" && minutes(attempt.created_at) > 30).length;
  checks.push(attempts.error
    ? { id: "transfers", label: "Recipient transfers", status: "error", detail: "Transfer attempts could not be checked." }
    : failedTransfers || staleAttempts
      ? { id: "transfers", label: "Recipient transfers", status: "warning", detail: `${failedTransfers} failed and ${staleAttempts} stale transfer attempt${failedTransfers + staleAttempts === 1 ? "" : "s"}.` }
      : { id: "transfers", label: "Recipient transfers", status: "healthy", detail: "No failed or stale transfer attempts." });

  const webhookRows = webhooks.data ?? [];
  const failedWebhooks = webhookRows.filter((event) => event.status === "failed").length;
  const lastWebhookAt = webhookRows[0]?.received_at ?? null;
  checks.push(webhooks.error
    ? { id: "webhooks", label: "RazorpayX webhooks", status: "error", detail: "Webhook processing history could not be checked." }
    : failedWebhooks
      ? { id: "webhooks", label: "RazorpayX webhooks", status: "warning", detail: `${failedWebhooks} recent webhook event${failedWebhooks === 1 ? " failed" : "s failed"} processing.` }
      : payoutsLive && (!lastWebhookAt || minutes(lastWebhookAt) > 24 * 60)
        ? { id: "webhooks", label: "RazorpayX webhooks", status: "warning", detail: "No RazorpayX webhook has been received in the last 24 hours." }
        : { id: "webhooks", label: "RazorpayX webhooks", status: "healthy", detail: payoutsLive ? "Recent webhook processing is healthy." : "Webhook freshness is not required while payouts are locked." });

  const status: HealthCheckStatus = checks.some((check) => check.status === "error") ? "error" : checks.some((check) => check.status === "warning") ? "warning" : "healthy";
  return {
    status,
    environment: process.env.VILLIX_ENVIRONMENT || process.env.NODE_ENV || "development",
    checkedAt: new Date().toISOString(),
    checks,
    counts: { receiptsNeedingReview, stuckPayouts, failedTransfers, failedWebhooks },
    lastWebhookAt,
  };
}
