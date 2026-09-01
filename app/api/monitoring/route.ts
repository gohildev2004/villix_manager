import { collectOperationalHealth } from "@/lib/operational-health";
import { errorResponse, requireAdmin } from "@/lib/villix-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase } = await requireAdmin();
    return Response.json(await collectOperationalHealth(supabase), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
