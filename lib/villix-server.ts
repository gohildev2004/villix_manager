import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";

export type VillixClient = SupabaseClient<Database>;

export type AuthenticatedAdmin = {
  userId: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "reviewer";
};

export async function requireAdmin(): Promise<{ actor: AuthenticatedAdmin; supabase: VillixClient }> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.email) throw new Response("Authentication required", { status: 401 });

  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id,email,display_name,role,active")
    .eq("user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (adminError) throw adminError;
  if (!admin) throw new Response("Administrator access required", { status: 403 });

  await supabase.from("admin_users").update({ last_seen_at: new Date().toISOString() }).eq("user_id", admin.user_id);
  return {
    supabase,
    actor: {
      userId: admin.user_id,
      email: admin.email,
      displayName: admin.display_name,
      role: admin.role as AuthenticatedAdmin["role"],
    },
  };
}

export async function addAudit(
  supabase: VillixClient,
  actor: AuthenticatedAdmin,
  action: string,
  entityType: string,
  entityId: string,
  title: string,
  detail: string,
  tone: "neutral" | "success" | "warning" = "neutral",
) {
  const { error } = await supabase.from("audit_events").insert({
    actor_id: actor.userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: { title, detail, tone, actor: actor.displayName },
  });
  if (error) throw error;
}

export function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "Unexpected server error";
  console.error(error);
  return Response.json({ error: message }, { status: 500 });
}

export function safeJson<T>(value: Json | null | undefined, fallback: T): T {
  return value === null || value === undefined ? fallback : value as T;
}
