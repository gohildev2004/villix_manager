import { fetchRazorpayxPayout, razorpayxConfigured } from "@/lib/razorpayx";
import { reconcileRazorpayxPayout } from "@/lib/razorpayx-reconciliation";
import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as { batchId?: string };
    if (!body.batchId) return Response.json({ error: "Choose a payout batch to sync." }, { status: 400 });
    if (!razorpayxConfigured()) return Response.json({ error: "RazorpayX server credentials are not configured." }, { status: 409 });

    const { data: recipients, error: recipientsError } = await supabase
      .from("payout_recipients")
      .select("id")
      .eq("batch_id", body.batchId);
    if (recipientsError) throw recipientsError;
    if (!recipients?.length) return Response.json({ error: "This payout batch has no recipients." }, { status: 404 });

    const { data: attempts, error: attemptsError } = await supabase
      .from("payment_attempts")
      .select("provider_reference")
      .eq("provider", "razorpayx")
      .in("payout_recipient_id", recipients.map((recipient) => recipient.id))
      .not("provider_reference", "is", null);
    if (attemptsError) throw attemptsError;
    const references = [...new Set((attempts ?? []).map((attempt) => attempt.provider_reference).filter((value): value is string => Boolean(value)))];
    if (!references.length) return Response.json({ error: "No RazorpayX transfer references exist for this batch yet." }, { status: 409 });

    const results = [];
    for (const reference of references) {
      const payout = await fetchRazorpayxPayout(reference);
      results.push(await reconcileRazorpayxPayout(supabase, payout));
    }
    await addAudit(supabase, actor, "payout.status_sync_requested", "payout_batch", body.batchId, "Payout statuses synchronized", `${references.length} RazorpayX transfer status${references.length === 1 ? " was" : "es were"} checked manually.`, "success");
    return Response.json({ ok: true, synced: results.length });
  } catch (error) {
    return errorResponse(error);
  }
}
