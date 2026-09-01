import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";
import { createRazorpayxPayout, mapRazorpayxPayoutStatus, razorpayxConfigured } from "@/lib/razorpayx";
import type { Json } from "@/lib/supabase/database.types";

function indiaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot send payouts." }, { status: 403 });
    if (process.env.PAYOUTS_LIVE_ENABLED !== "true") {
      return Response.json({ error: "Payouts are locked in test mode. No real transfers can be created." }, { status: 409 });
    }
    const body = await request.json() as { batchId?: string; confirmed?: boolean };
    if (!body.confirmed || !body.batchId) return Response.json({ error: "Confirm the approved batch before sending money." }, { status: 400 });
    if (!razorpayxConfigured()) return Response.json({ error: "Connect RazorpayX server credentials before sending this batch." }, { status: 409 });

    const { data: batch, error: batchError } = await supabase.from("payout_batches").select("id,status,payout_date,payout_recipients(id,person_id,payout_currency,payout_amount_minor,payout_provider,status)").eq("id", body.batchId).maybeSingle();
    if (batchError) throw batchError;
    if (!batch || batch.status !== "approved") return Response.json({ error: "Only an approved, unsent payout batch can be dispatched." }, { status: 409 });
    if (!batch.payout_date || batch.payout_date > indiaDate()) return Response.json({ error: `This batch is scheduled for ${batch.payout_date}. It cannot be sent early.` }, { status: 409 });
    if (!batch.payout_recipients.length) throw new Error("This batch has no payable recipients.");
    if (batch.payout_recipients.some((recipient) => recipient.payout_currency !== "INR" || recipient.payout_provider !== "razorpayx")) {
      return Response.json({ error: "Every Villix recipient must use an INR RazorpayX fund account linked to an Indian bank." }, { status: 409 });
    }
    if (batch.payout_recipients.some((recipient) => recipient.status !== "ready")) return Response.json({ error: "Every recipient must be ready and unsent before dispatch." }, { status: 409 });

    const personIds = batch.payout_recipients.map((recipient) => recipient.person_id);
    const [{ data: profiles, error: profilesError }, { data: people, error: peopleError }] = await Promise.all([
      supabase.from("payee_profiles").select("person_id,onboarding_status,payout_provider,provider_recipient_id").in("person_id", personIds),
      supabase.from("people").select("id,display_name").in("id", personIds),
    ]);
    if (profilesError) throw profilesError;
    if (peopleError) throw peopleError;
    const profileByPerson = new Map((profiles ?? []).map((profile) => [profile.person_id, profile]));
    const nameByPerson = new Map((people ?? []).map((person) => [person.id, person.display_name]));
    const missing = batch.payout_recipients.filter((recipient) => {
      const profile = profileByPerson.get(recipient.person_id);
      return !profile || profile.onboarding_status !== "ready" || profile.payout_provider !== "razorpayx" || !profile.provider_recipient_id;
    });
    if (missing.length) return Response.json({ error: `${missing.length} recipient${missing.length === 1 ? " is" : "s are"} missing a ready RazorpayX fund account.` }, { status: 409 });

    const existingAttempts = await supabase.from("payment_attempts").select("payout_recipient_id,status").in("payout_recipient_id", batch.payout_recipients.map((recipient) => recipient.id));
    if (existingAttempts.error) throw existingAttempts.error;
    if (existingAttempts.data?.length) return Response.json({ error: "This batch already has payment attempts. Reconcile them before retrying to prevent duplicate transfers." }, { status: 409 });

    const results: Array<{ personId: string; status: string; reference: string }> = [];
    await supabase.from("payout_batches").update({ status: "processing" }).eq("id", batch.id);
    for (const recipient of batch.payout_recipients) {
      const profile = profileByPerson.get(recipient.person_id)!;
      const idempotencyKey = `${recipient.id.replaceAll("-", "").slice(0, 28)}-v1`;
      const { error: attemptError } = await supabase.from("payment_attempts").insert({ payout_recipient_id: recipient.id, attempt_number: 1, idempotency_key: idempotencyKey, amount_cents: recipient.payout_amount_minor, currency: "INR", status: "processing", provider: "razorpayx", attempted_by: actor.userId });
      if (attemptError) throw attemptError;
      await supabase.from("payout_recipients").update({ status: "processing" }).eq("id", recipient.id);
      const payout = await createRazorpayxPayout({ fundAccountId: profile.provider_recipient_id!, amountPaise: recipient.payout_amount_minor, idempotencyKey, referenceId: `${batch.id.slice(0, 8)}-${recipient.id.slice(0, 8)}`, recipientName: nameByPerson.get(recipient.person_id) ?? "Villix recipient" });
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
    }
    const allPaid = results.every((result) => result.status === "paid");
    await supabase.from("payout_batches").update({ status: allPaid ? "paid" : "processing" }).eq("id", batch.id);
    await addAudit(supabase, actor, "payout.dispatched", "payout_batch", batch.id, "Payout batch sent to RazorpayX", `${results.length} recipient transfers were created with idempotency protection.`, "success");
    return Response.json({ ok: true, results });
  } catch (error) { return errorResponse(error); }
}
