import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AuthenticatedPayee = {
  userId: string;
  personId: string | null;
  applicationId: string | null;
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
  if (account && account.status === "suspended") throw new Response("Payee portal access required", { status: 403 });

  const { data: application, error: applicationError } = account ? { data: null, error: null } : await admin
    .from("contributor_applications")
    .select("id,person_id,status")
    .eq("auth_user_id", userData.user.id)
    .neq("status", "declined")
    .maybeSingle();
  if (applicationError) throw applicationError;
  if (!account && !application) throw new Response("Contributor portal access required", { status: 403 });

  const now = new Date().toISOString();
  if (account?.status === "invited") {
    const { error } = await admin.from("payee_portal_accounts").update({ status: "active", activated_at: now, last_seen_at: now }).eq("user_id", account.user_id);
    if (error) throw error;
  } else if (account) {
    const { error } = await admin.from("payee_portal_accounts").update({ last_seen_at: now }).eq("user_id", account.user_id);
    if (error) throw error;
  }

  return {
    admin,
    payee: {
      userId: userData.user.id,
      personId: account?.person_id ?? application?.person_id ?? null,
      applicationId: application?.id ?? null,
      email: userData.user.email,
      status: account?.status === "invited" ? "invited" : "active",
    } satisfies AuthenticatedPayee,
  };
}
