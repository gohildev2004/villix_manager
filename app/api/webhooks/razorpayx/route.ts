import { createHash } from "node:crypto";
import { reconcileRazorpayxPayout } from "@/lib/razorpayx-reconciliation";
import { type RazorpayPayout, verifyRazorpayxWebhook } from "@/lib/razorpayx";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 1_000_000;

type RazorpayWebhook = {
  event?: string;
  payload?: { payout?: { entity?: RazorpayPayout } };
};

function message(error: unknown) {
  return (error instanceof Error ? error.message : "Webhook processing failed.").slice(0, 1000);
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_WEBHOOK_BYTES) return Response.json({ error: "Webhook payload is too large." }, { status: 413 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";
  if (!eventId || eventId.length > 255) return Response.json({ error: "Missing webhook event ID." }, { status: 400 });

  try {
    if (!verifyRazorpayxWebhook(rawBody, signature)) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 503 });
  }

  let webhook: RazorpayWebhook;
  try {
    webhook = JSON.parse(rawBody) as RazorpayWebhook;
  } catch {
    return Response.json({ error: "Invalid webhook JSON." }, { status: 400 });
  }

  const eventType = String(webhook.event ?? "unknown").slice(0, 255);
  const payout = webhook.payload?.payout?.entity;
  const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
  const supabase = createAdminClient();
  const { error: insertError } = await supabase.from("provider_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    provider_reference: payout?.id ?? null,
    payload_sha256: payloadSha256,
  });
  if (insertError?.code === "23505") return Response.json({ ok: true, duplicate: true });
  if (insertError) return Response.json({ error: "Unable to record the webhook safely." }, { status: 500 });

  try {
    if (!eventType.startsWith("payout.") || !payout?.id || !payout.status) {
      await supabase.from("provider_webhook_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("event_id", eventId);
      return Response.json({ ok: true, ignored: true });
    }

    const result = await reconcileRazorpayxPayout(supabase, payout);
    const processedAt = new Date().toISOString();
    const { error: ledgerError } = await supabase.from("provider_webhook_events").update({
      status: result.matched ? "processed" : "ignored",
      processed_at: processedAt,
    }).eq("event_id", eventId);
    if (ledgerError) throw ledgerError;

    if (result.matched && result.changed) {
      const { error: auditError } = await supabase.from("audit_events").insert({
        actor_id: null,
        action: "payout.status_synced",
        entity_type: "payout_batch",
        entity_id: result.batchId,
        details: {
          title: `Payout ${result.status}`,
          detail: `RazorpayX confirmed payout ${payout.id} as ${payout.status}.`,
          tone: result.status === "failed" ? "warning" : result.status === "paid" ? "success" : "neutral",
          actor: "RazorpayX webhook",
        },
      });
      if (auditError) throw auditError;
    }
    return Response.json({ ok: true, matched: result.matched });
  } catch (error) {
    await supabase.from("provider_webhook_events").update({
      status: "failed",
      error: message(error),
      processed_at: new Date().toISOString(),
    }).eq("event_id", eventId);
    return Response.json({ error: "Webhook processing failed safely and can be retried." }, { status: 500 });
  }
}
