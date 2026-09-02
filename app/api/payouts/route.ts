import { addAudit, errorResponse, requireAdmin, safeJson } from "@/lib/villix-server";
import { isPayoutWeekday, scheduledPayoutDate } from "@/lib/payout-schedule";
import { calculatePayoutDistribution, settlementAmount } from "@/lib/payout-calculation";

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as { action?: string; periodStart?: string; periodEnd?: string; exchangeRate?: number; settlementAdjustmentBps?: number };
    if (body.action !== "approve") throw new Error("Unsupported payout action.");
    const periodStart = String(body.periodStart ?? "");
    const periodEnd = String(body.periodEnd ?? "");
    if (![periodStart, periodEnd].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new Error("A valid weekly payout period is required.");
    }
    if (periodStart > periodEnd) throw new Error("The payout period is invalid.");
    const exchangeRate = Number(body.exchangeRate);
    const settlementAdjustmentBps = Number(body.settlementAdjustmentBps ?? 0);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 1000) throw new Error("Enter the Stripe INR received per $1 USD for this week.");
    if (!Number.isInteger(settlementAdjustmentBps) || settlementAdjustmentBps < 0 || settlementAdjustmentBps > 2000) throw new Error("The additional adjustment must be between 0% and 20%.");
    const { data: policyRow, error: policyError } = await supabase.from("workspace_settings").select("value").eq("key", "payout_policy").maybeSingle();
    if (policyError) throw policyError;
    const policy = safeJson<Record<string, unknown>>(policyRow?.value, {});
    const payoutDay = isPayoutWeekday(policy.payoutDay) ? policy.payoutDay : "Monday";
    const payoutDate = scheduledPayoutDate(periodEnd, payoutDay);

    const { data: receipts, error: receiptsError } = await supabase
      .from("receipts")
      .select("id,status")
      .gte("receipt_date", periodStart)
      .lte("receipt_date", periodEnd);
    if (receiptsError) throw receiptsError;
    if ((receipts ?? []).some((receipt) => receipt.status !== "approved")) {
      throw new Error("Approve every verified receipt in this week before approving its payout.");
    }
    const approvedReceiptIds = (receipts ?? []).filter((receipt) => receipt.status === "approved").map((receipt) => receipt.id);
    if (!approvedReceiptIds.length) throw new Error("No approved contribution entries exist for this week.");

    const { data: existing, error: existingError } = await supabase
      .from("payout_batches")
      .select("id,status,exchange_rate")
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "paid" || (existing?.status === "approved" && existing.exchange_rate)) {
      return Response.json({ error: "This weekly payout has already been approved." }, { status: 409 });
    }

    const { data: entries, error: entriesError } = await supabase
      .from("contribution_entries")
      .select("id,contributor_id,source_name,source_handle,type,gross_cents,payout_cents,rule_version,receipts!inner(receipt_date)")
      .in("receipt_id", approvedReceiptIds)
      .order("id");
    if (entriesError) throw entriesError;
    if (!(entries ?? []).length) throw new Error("No approved contribution entries exist for this week.");
    if ((entries ?? []).some((entry) => !entry.contributor_id)) throw new Error("Every contribution handle must be matched before payout approval.");
    if ((entries ?? []).some((entry) => entry.payout_cents === null)) throw new Error("Every contribution type must have a published payout rule before approval.");
    const ruleVersions = [...new Set((entries ?? []).map((entry) => entry.rule_version))];
    if (ruleVersions.length !== 1) throw new Error("This week contains receipts from multiple rule versions. Split the payout period before approval.");
    const ruleVersion = ruleVersions[0];

    const contributorIds = [...new Set((entries ?? []).map((entry) => entry.contributor_id!))];
    const [{ data: people, error: peopleError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      supabase.from("people").select("id,display_name,team_lead_id,currency").in("id", contributorIds),
      supabase.from("team_assignments").select("contributor_id,team_lead_id,effective_from,effective_to").in("contributor_id", contributorIds).order("effective_from", { ascending: false }),
    ]);
    if (peopleError) throw peopleError;
    if (assignmentsError) throw assignmentsError;
    const distribution = calculatePayoutDistribution({
      entries: (entries ?? []).map((entry) => ({ ...entry, receipt_date: entry.receipts.receipt_date })),
      people: people ?? [],
      assignments: assignments ?? [],
    });
    const { totalGrossCents, totalPayableCents, calculationEntries } = distribution;
    const recipientSnapshots = distribution.recipients.map((recipient) => {
      const grossSettlementCents = settlementAmount(recipient.grossCents, exchangeRate, settlementAdjustmentBps);
      const payableSettlementCents = settlementAmount(recipient.payableCents, exchangeRate, settlementAdjustmentBps);
      return {
        recipient,
        grossSettlementCents,
        payableSettlementCents,
        retainedSettlementCents: grossSettlementCents - payableSettlementCents,
        currency: "INR",
        payoutFxRate: 1,
        payoutAmountMinor: payableSettlementCents,
        provider: "razorpayx",
      };
    });
    const totalGrossSettlementCents = settlementAmount(totalGrossCents, exchangeRate, settlementAdjustmentBps);
    const totalPayableSettlementCents = recipientSnapshots.reduce((sum, snapshot) => sum + snapshot.payableSettlementCents, 0);
    const recipientIds = recipientSnapshots.map((snapshot) => snapshot.recipient.personId);
    const { data: payeeProfiles, error: payeeProfilesError } = recipientIds.length
      ? await supabase.from("payee_profiles").select("person_id,onboarding_status,payout_provider,provider_recipient_id").in("person_id", recipientIds)
      : { data: [], error: null };
    if (payeeProfilesError) throw payeeProfilesError;
    const profileByPerson = new Map((payeeProfiles ?? []).map((profile) => [profile.person_id, profile]));
    const readiness = (personId: string) => {
      const profile = profileByPerson.get(personId);
      if (!profile || profile.onboarding_status !== "ready") return { status: "held", reason: "Bank onboarding is incomplete." } as const;
      if (profile.payout_provider !== "razorpayx" || !profile.provider_recipient_id) return { status: "held", reason: "A verified RazorpayX fund account is required." } as const;
      return { status: "ready", reason: null } as const;
    };

    const batchId = existing?.id ?? crypto.randomUUID();
    const calculationHash = await digest(JSON.stringify({ periodStart, periodEnd, ruleVersion, exchangeRate, settlementAdjustmentBps, entries: calculationEntries, recipients: recipientSnapshots.map(({ recipient, ...snapshot }) => ({ personId: recipient.personId, ...snapshot })) }));
    const batch = {
      payout_date: payoutDate,
      source_currency: "USD",
      settlement_currency: "INR",
      exchange_rate: exchangeRate,
      settlement_adjustment_bps: settlementAdjustmentBps,
      total_gross_settlement_cents: totalGrossSettlementCents,
      total_retained_settlement_cents: totalGrossSettlementCents - totalPayableSettlementCents,
      total_payable_settlement_cents: totalPayableSettlementCents,
      payout_provider: "razorpayx",
      status: "approved" as const,
      total_gross_cents: totalGrossCents,
      total_retained_cents: totalGrossCents - totalPayableCents,
      total_payable_cents: totalPayableCents,
      rule_version: ruleVersion,
      calculation_hash: calculationHash,
      approved_by: actor.userId,
      approved_at: new Date().toISOString(),
    };
    if (existing) {
      const { error: deleteError } = await supabase.from("payout_recipients").delete().eq("batch_id", batchId);
      if (deleteError) throw deleteError;
      const { error: updateError } = await supabase.from("payout_batches").update(batch).eq("id", batchId);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase.from("payout_batches").insert({ id: batchId, period_start: periodStart, period_end: periodEnd, ...batch });
      if (insertError) throw insertError;
    }

    if (recipientSnapshots.length) {
      const approvedAt = new Date().toISOString();
      const { error: recipientError } = await supabase.from("payout_recipients").insert(recipientSnapshots.map(({ recipient, ...snapshot }) => {
        const recipientReadiness = readiness(recipient.personId);
        return ({
        id: crypto.randomUUID(),
        batch_id: batchId,
        person_id: recipient.personId,
        routing_type: recipient.routingType,
        contributor_count: recipient.contributors.length,
        gross_cents: recipient.grossCents,
        retained_cents: recipient.grossCents - recipient.payableCents,
        payable_cents: recipient.payableCents,
        gross_settlement_cents: snapshot.grossSettlementCents,
        retained_settlement_cents: snapshot.retainedSettlementCents,
        payable_settlement_cents: snapshot.payableSettlementCents,
        payout_currency: snapshot.currency,
        payout_amount_minor: snapshot.payoutAmountMinor,
        payout_fx_rate: snapshot.payoutFxRate,
        payout_provider: snapshot.provider,
        contributor_breakdown: recipient.contributors.map((contributor) => ({ ...contributor, grossSettlementCents: settlementAmount(contributor.grossCents, exchangeRate, settlementAdjustmentBps), payableSettlementCents: settlementAmount(contributor.payableCents, exchangeRate, settlementAdjustmentBps) })),
        status: recipientReadiness.status,
        hold_reason: recipientReadiness.reason,
        held_at: recipientReadiness.status === "held" ? approvedAt : null,
      }); }));
      if (recipientError) throw recipientError;
    }

    await addAudit(supabase, actor, "payout.approved", "payout_batch", batchId, "Payout batch approved", `$${(totalPayableCents / 100).toFixed(2)} source / ₹${(totalPayableSettlementCents / 100).toFixed(2)} settlement approved for ${recipientSnapshots.length} recipients on ${payoutDate}.`, "success");
    return Response.json({ id: batchId, status: "Approved", totalPayable: totalPayableCents / 100, totalPayableInr: totalPayableSettlementCents / 100 });
  } catch (error) {
    return errorResponse(error);
  }
}
