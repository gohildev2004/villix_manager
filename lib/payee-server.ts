import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AuthenticatedPayee = {
  userId: string;
  personId: string;
  email: string;
  status: "invited" | "active";
};

export async function requirePayee() {
  const sessionClient = await createClient();
  const { data: userData, error: userError } = await sessionClient.auth.getUser();
  if (userError || !userData.user?.email) throw new Response("Authentication required", { status: 401 });

  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("payee_portal_accounts")
    .select("person_id,user_id,status")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account || account.status === "suspended") throw new Response("Payee portal access required", { status: 403 });

  const now = new Date().toISOString();
  if (account.status === "invited") {
    const { error } = await admin.from("payee_portal_accounts").update({ status: "active", activated_at: now, last_seen_at: now }).eq("user_id", account.user_id);
    if (error) throw error;
  } else {
    const { error } = await admin.from("payee_portal_accounts").update({ last_seen_at: now }).eq("user_id", account.user_id);
    if (error) throw error;
  }

  return {
    admin,
    payee: {
      userId: account.user_id,
      personId: account.person_id,
      email: userData.user.email,
      status: account.status === "invited" ? "invited" : "active",
    } satisfies AuthenticatedPayee,
  };
}
