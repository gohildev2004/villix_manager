import type { Json } from "@/lib/supabase/database.types";
import type { VillixClient } from "@/lib/villix-server";
import { mapRazorpayxPayoutStatus, type RazorpayPayout } from "@/lib/razorpayx";

function safeStatusDetails(payout: RazorpayPayout): Json {
  return {
    status: payout.status,
    status_details: (payout.status_details ?? null) as Json,
  };
}

function failureReason(payout: RazorpayPayout) {
  if (payout.failure_reason) return payout.failure_reason;
  const details = payout.status_details;
  if (!details) return null;
  for (const key of ["description", "reason", "source", "step"]) {
    const value = details[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 500);
  }
  return null;
}

export async function reconcileRazorpayxPayout(supabase: VillixClient, payout: RazorpayPayout) {
  const { data: attempt, error: attemptError } = await supabase
    .from("payment_attempts")
    .select("id,payout_recipient_id,status")
    .eq("provider", "razorpayx")
    .eq("provider_reference", payout.id)
    .maybeSingle();
  if (attemptError) throw attemptError;
  if (!attempt) return { matched: false as const, status: mapRazorpayxPayoutStatus(payout.status) };

  const status = mapRazorpayxPayoutStatus(payout.status);
  const { error: updateAttemptError } = await supabase.from("payment_attempts").update({
    status,
    provider_status: payout.status,
    provider_status_details: safeStatusDetails(payout),
    failure_reason: status === "failed" ? failureReason(payout) : null,
  }).eq("id", attempt.id);
  if (updateAttemptError) throw updateAttemptError;

  const { data: recipient, error: recipientError } = await supabase
    .from("payout_recipients")
    .select("id,batch_id,person_id")
    .eq("id", attempt.payout_recipient_id)
    .single();
  if (recipientError) throw recipientError;
  const { error: updateRecipientError } = await supabase.from("payout_recipients").update({
    status,
    provider_reference: payout.id,
    paid_at: status === "paid" ? new Date().toISOString() : null,
  }).eq("id", recipient.id);
  if (updateRecipientError) throw updateRecipientError;

  const { data: recipients, error: recipientsError } = await supabase
    .from("payout_recipients")
    .select("status")
    .eq("batch_id", recipient.batch_id);
  if (recipientsError) throw recipientsError;
  const batchStatus = recipients?.length && recipients.every((item) => item.status === "paid") ? "paid" : "processing";
  const { error: batchError } = await supabase.from("payout_batches").update({ status: batchStatus }).eq("id", recipient.batch_id);
  if (batchError) throw batchError;

  return {
    matched: true as const,
    changed: attempt.status !== status,
    status,
    batchId: recipient.batch_id,
    personId: recipient.person_id,
  };
}
