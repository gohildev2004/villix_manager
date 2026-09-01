import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("workspace_settings").select("key").limit(1);
    if (error) throw error;
    return Response.json({ status: "ready", service: "villix-manager" }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable", service: "villix-manager" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
