import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

type Recipient = {
  personId: string;
  routingType: "direct" | "team";
  grossCents: number;
  payableCents: number;
  contributors: Map<string, { name: string; handle: string; grossCents: number; payableCents: number }>;
};

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as { action?: string; payoutDate?: string; periodStart?: string; periodEnd?: string };
    if (body.action !== "approve") throw new Error("Unsupported payout action.");
    const periodStart = String(body.periodStart ?? "");
    const periodEnd = String(body.periodEnd ?? "");
    const payoutDate = String(body.payoutDate ?? "");
    if (![periodStart, periodEnd, payoutDate].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new Error("A valid weekly period and payout date are required.");
    }
    if (periodStart > periodEnd) throw new Error("The payout period is invalid.");

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
      .select("id,status")
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "approved" || existing?.status === "paid") {
      return Response.json({ error: "This weekly payout has already been approved." }, { status: 409 });
    }

    const { data: entries, error: entriesError } = await supabase
      .from("contribution_entries")
      .select("id,contributor_id,source_name,source_handle,type,gross_cents,payout_cents,receipts!inner(receipt_date)")
      .in("receipt_id", approvedReceiptIds)
      .order("id");
    if (entriesError) throw entriesError;
    if (!(entries ?? []).length) throw new Error("No approved contribution entries exist for this week.");
    if ((entries ?? []).some((entry) => !entry.contributor_id)) throw new Error("Every contribution handle must be matched before payout approval.");

    const contributorIds = [...new Set((entries ?? []).map((entry) => entry.contributor_id!))];
    const [{ data: people, error: peopleError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      supabase.from("people").select("id,display_name,team_lead_id").in("id", contributorIds),
      supabase.from("team_assignments").select("contributor_id,team_lead_id,effective_from,effective_to").in("contributor_id", contributorIds).order("effective_from", { ascending: false }),
    ]);
    if (peopleError) throw peopleError;
    if (assignmentsError) throw assignmentsError;
    const peopleById = new Map((people ?? []).map((person) => [person.id, person]));

    const recipients = new Map<string, Recipient>();
    let totalGrossCents = 0;
    let totalPayableCents = 0;
    const calculationEntries: Array<{ id: string; grossCents: number; type: string; recipient: string }> = [];
    for (const entry of entries ?? []) {
      const contributorId = entry.contributor_id!;
      const person = peopleById.get(contributorId);
      if (!person) throw new Error(`Contributor ${entry.source_handle} is no longer available.`);
      const receiptDate = entry.receipts.receipt_date;
      const historical = (assignments ?? []).find((assignment) => assignment.contributor_id === contributorId && assignment.effective_from <= receiptDate && (!assignment.effective_to || assignment.effective_to >= receiptDate));
      const teamLeadId = historical ? historical.team_lead_id : person.team_lead_id;
      const recipientId = teamLeadId ?? contributorId;
      const payoutCents = entry.type === "problem" ? Math.round(entry.gross_cents / 2) : 0;
      totalGrossCents += entry.gross_cents;
      totalPayableCents += payoutCents;
      calculationEntries.push({ id: entry.id, grossCents: entry.gross_cents, type: entry.type, recipient: recipientId });

      const recipient = recipients.get(recipientId) ?? {
        personId: recipientId,
        routingType: teamLeadId ? "team" : "direct",
        grossCents: 0,
        payableCents: 0,
        contributors: new Map(),
      };
      recipient.grossCents += entry.gross_cents;
      recipient.payableCents += payoutCents;
      const contributor = recipient.contributors.get(contributorId) ?? {
        name: person.display_name,
        handle: entry.source_handle,
        grossCents: 0,
        payableCents: 0,
      };
      contributor.grossCents += entry.gross_cents;
      contributor.payableCents += payoutCents;
      recipient.contributors.set(contributorId, contributor);
      recipients.set(recipientId, recipient);
    }

    const batchId = existing?.id ?? crypto.randomUUID();
    const calculationHash = await digest(JSON.stringify({ periodStart, periodEnd, ruleVersion: 1, entries: calculationEntries }));
    const batch = {
      payout_date: payoutDate,
      source_currency: "USD",
      settlement_currency: "INR",
      status: "approved" as const,
      total_gross_cents: totalGrossCents,
      total_retained_cents: totalGrossCents - totalPayableCents,
      total_payable_cents: totalPayableCents,
      rule_version: 1,
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

    const payableRecipients = [...recipients.values()].filter((recipient) => recipient.payableCents > 0);
    if (payableRecipients.length) {
      const { error: recipientError } = await supabase.from("payout_recipients").insert(payableRecipients.map((recipient) => ({
        id: crypto.randomUUID(),
        batch_id: batchId,
        person_id: recipient.personId,
        routing_type: recipient.routingType,
        contributor_count: recipient.contributors.size,
        gross_cents: recipient.grossCents,
        retained_cents: recipient.grossCents - recipient.payableCents,
        payable_cents: recipient.payableCents,
        contributor_breakdown: [...recipient.contributors.values()],
        status: "ready",
      })));
      if (recipientError) throw recipientError;
    }

    await addAudit(supabase, actor, "payout.approved", "payout_batch", batchId, "Payout batch approved", `$${(totalPayableCents / 100).toFixed(2)} approved for ${payableRecipients.length} recipients on ${payoutDate}.`, "success");
    return Response.json({ id: batchId, status: "Approved", totalPayable: totalPayableCents / 100 });
  } catch (error) {
    return errorResponse(error);
  }
}
