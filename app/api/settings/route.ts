import { addAudit, errorResponse, requireAdmin, safeJson } from "@/lib/villix-server";
import { isPayoutWeekday } from "@/lib/payout-schedule";

export async function PATCH(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot change payout settings." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    if (!isPayoutWeekday(body.payoutDay)) return Response.json({ error: "Choose a valid payout weekday." }, { status: 400 });

    const { data: current, error: currentError } = await supabase.from("workspace_settings").select("value").eq("key", "payout_policy").maybeSingle();
    if (currentError) throw currentError;
    const value = { ...safeJson<Record<string, unknown>>(current?.value, {}), payoutDay: body.payoutDay };
    const { error: updateError } = await supabase.from("workspace_settings").upsert({ key: "payout_policy", value, updated_by: actor.userId, updated_at: new Date().toISOString() });
    if (updateError) throw updateError;
    await addAudit(supabase, actor, "settings.payout_schedule_updated", "workspace_setting", "payout_policy", "Payout schedule updated", `Weekly payouts are now scheduled for ${body.payoutDay}.`);
    return Response.json({ ok: true, payoutDay: body.payoutDay });
  } catch (error) { return errorResponse(error); }
}
