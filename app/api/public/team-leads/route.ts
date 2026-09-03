import { requireApplicationApiKey } from "@/lib/contributor-applications";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireApplicationApiKey(request);
    const { data, error } = await createAdminClient().from("people").select("id,display_name").eq("role", "team_lead").eq("status", "active").order("display_name");
    if (error) throw error;
    return Response.json({ teamLeads: (data ?? []).map((lead) => ({ id: lead.id, name: lead.display_name })) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Team lead directory failed", error);
    return Response.json({ error: "Team leaders are temporarily unavailable." }, { status: 503 });
  }
}
