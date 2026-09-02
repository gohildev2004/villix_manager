import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";
import { createRazorpayxPayout, mapRazorpayxPayoutStatus, razorpayxConfigured } from "@/lib/razorpayx";
import type { Json } from "@/lib/supabase/database.types";

function indiaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function holdReason(profile: { onboarding_status: string; payout_provider: string | null; provider_recipient_id: string | null } | undefined) {
  if (!profile || profile.onboarding_status !== "ready") return "Bank onboarding is incomplete.";
  if (profile.payout_provider !== "razorpayx" || !profile.provider_recipient_id) return "A verified RazorpayX fund account is required.";
  return null;
}

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot send payouts." }, { status: 403 });
    if (process.env.PAYOUTS_LIVE_ENABLED !== "true") {
      return Response.json({ error: "Payouts are locked in test mode. No real transfers can be created." }, { status: 409 });
    }
    const body = await request.json() as { batchId?: string; confirmed?: boolean; personIds?: string[] };
    if (!body.confirmed || !body.batchId) return Response.json({ error: "Confirm the approved batch before sending money." }, { status: 400 });
    if (!razorpayxConfigured()) return Response.json({ error: "Connect RazorpayX server credentials before sending this batch." }, { status: 409 });

    const { data: batch, error: batchError } = await supabase
      .from("payout_batches")
      .select("id,status,payout_date,payout_recipients(id,person_id,payout_currency,payout_amount_minor,payout_provider,status)")
      .eq("id", body.batchId)
      .maybeSingle();
    if (batchError) throw batchError;
    if (!batch || !["approved", "processing"].includes(batch.status)) {
      return Response.json({ error: "Only an approved payout batch with outstanding recipients can be dispatched." }, { status: 409 });
    }
    if (!batch.payout_date || batch.payout_date > indiaDate()) return Response.json({ error: `This batch is scheduled for ${batch.payout_date}. It cannot be sent early.` }, { status: 409 });
    if (!batch.payout_recipients.length) throw new Error("This batch has no payable recipients.");
    if (batch.payout_recipients.some((recipient) => recipient.payout_currency !== "INR" || recipient.payout_provider !== "razorpayx")) {
      return Response.json({ error: "Every Villix recipient must use an INR RazorpayX fund account linked to an Indian bank." }, { status: 409 });
    }

    const personIds = batch.payout_recipients.map((recipient) => recipient.person_id);
    const [{ data: profiles, error: profilesError }, { data: people, error: peopleError }] = await Promise.all([
      supabase.from("payee_profiles").select("person_id,onboarding_status,payout_provider,provider_recipient_id").in("person_id", personIds),
      supabase.from("people").select("id,display_name").in("id", personIds),
    ]);
    if (profilesError) throw profilesError;
    if (peopleError) throw peopleError;
    const profileByPerson = new Map((profiles ?? []).map((profile) => [profile.person_id, profile]));
    const nameByPerson = new Map((people ?? []).map((person) => [person.id, person.display_name]));
    const refreshedStatuses = new Map<string, string>();

    for (const recipient of batch.payout_recipients) {
      if (["paid", "processing", "cancelled"].includes(recipient.status)) {
        refreshedStatuses.set(recipient.id, recipient.status);
        continue;
      }
      const reason = holdReason(profileByPerson.get(recipient.person_id));
      const status = reason ? "held" : recipient.status === "failed" ? "failed" : "ready";
      const { error: readinessError } = await supabase.from("payout_recipients").update({
        status,
        hold_reason: reason,
        held_at: reason ? new Date().toISOString() : null,
      }).eq("id", recipient.id);
      if (readinessError) throw readinessError;
      refreshedStatuses.set(recipient.id, status);
    }

    const requestedPeople = body.personIds?.length ? new Set(body.personIds) : null;
    const targets = batch.payout_recipients.filter((recipient) => {
      const status = refreshedStatuses.get(recipient.id) ?? recipient.status;
      if (requestedPeople && !requestedPeople.has(recipient.person_id)) return false;
      return requestedPeople ? ["ready", "failed"].includes(status) : status === "ready";
    });
    if (!targets.length) {
      const held = [...refreshedStatuses.values()].filter((status) => status === "held").length;
      return Response.json({ error: held ? `No selected recipients are ready. ${held} payout${held === 1 ? " remains" : "s remain"} on hold until bank setup is complete.` : "No selected recipients are ready to send. Sync processing transfers before retrying." }, { status: 409 });
    }

    const { data: attempts, error: attemptsError } = await supabase
      .from("payment_attempts")
      .select("payout_recipient_id,attempt_number,status")
      .in("payout_recipient_id", targets.map((recipient) => recipient.id));
    if (attemptsError) throw attemptsError;
    const attemptsByRecipient = new Map<string, NonNullable<typeof attempts>>();
    for (const attempt of attempts ?? []) {
      const current = attemptsByRecipient.get(attempt.payout_recipient_id) ?? [];
      current.push(attempt);
      attemptsByRecipient.set(attempt.payout_recipient_id, current);
    }

    const results: Array<{ personId: string; status: string; reference: string | null }> = [];
    for (const recipient of targets) {
      const profile = profileByPerson.get(recipient.person_id)!;
      const previousAttempts = attemptsByRecipient.get(recipient.id) ?? [];
      if (previousAttempts.some((attempt) => attempt.status === "processing")) continue;
      const attemptNumber = previousAttempts.reduce((highest, attempt) => Math.max(highest, attempt.attempt_number), 0) + 1;
      const idempotencyKey = `${recipient.id.replaceAll("-", "").slice(0, 28)}-v${attemptNumber}`;
      const { error: attemptError } = await supabase.from("payment_attempts").insert({
        payout_recipient_id: recipient.id,
        attempt_number: attemptNumber,
        idempotency_key: idempotencyKey,
        amount_cents: recipient.payout_amount_minor,
        currency: "INR",
        status: "processing",
        provider: "razorpayx",
        attempted_by: actor.userId,
      });
      if (attemptError) throw attemptError;
      const { error: processingError } = await supabase.from("payout_recipients").update({ status: "processing", hold_reason: null, held_at: null }).eq("id", recipient.id);
      if (processingError) throw processingError;

      try {
        const payout = await createRazorpayxPayout({
          fundAccountId: profile.provider_recipient_id!,
          amountPaise: recipient.payout_amount_minor,
          idempotencyKey,
          referenceId: `${batch.id.slice(0, 8)}-${recipient.id.slice(0, 8)}-${attemptNumber}`,
          recipientName: nameByPerson.get(recipient.person_id) ?? "Villix recipient",
        });
        const status = mapRazorpayxPayoutStatus(payout.status);
        await supabase.from("payment_attempts").update({
          status,
          provider_reference: payout.id,
          provider_status: payout.status,
          provider_status_details: { status: payout.status, status_details: (payout.status_details ?? null) as Json },
          failure_reason: payout.failure_reason ?? null,
        }).eq("idempotency_key", idempotencyKey);
        await supabase.from("payout_recipients").update({ status, provider_reference: payout.id, paid_at: status === "paid" ? new Date().toISOString() : null }).eq("id", recipient.id);
        results.push({ personId: recipient.person_id, status, reference: payout.id });
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : "RazorpayX rejected the transfer.";
        await supabase.from("payment_attempts").update({ status: "failed", failure_reason: failureReason }).eq("idempotency_key", idempotencyKey);
        await supabase.from("payout_recipients").update({ status: "failed", paid_at: null }).eq("id", recipient.id);
        results.push({ personId: recipient.person_id, status: "failed", reference: null });
      }
    }

    const { data: finalRecipients, error: finalRecipientsError } = await supabase.from("payout_recipients").select("status").eq("batch_id", batch.id);
    if (finalRecipientsError) throw finalRecipientsError;
    const allPaid = Boolean(finalRecipients?.length) && finalRecipients.every((recipient) => recipient.status === "paid");
    await supabase.from("payout_batches").update({ status: allPaid ? "paid" : "processing" }).eq("id", batch.id);
    const failed = results.filter((result) => result.status === "failed").length;
    const held = finalRecipients?.filter((recipient) => recipient.status === "held").length ?? 0;
    await addAudit(supabase, actor, "payout.dispatched", "payout_batch", batch.id, "Ready recipient payouts sent to RazorpayX", `${results.length - failed} transfer${results.length - failed === 1 ? " was" : "s were"} created, ${failed} failed, and ${held} remain on hold.`, failed ? "warning" : "success");
    return Response.json({ ok: true, results, sent: results.length - failed, failed, held });
  } catch (error) {
    return errorResponse(error);
  }
}
