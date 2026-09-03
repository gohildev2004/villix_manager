import { timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const contributorInvitationSubject = "Complete your Villix contributor profile";
export const contributorInvitationMessage = `Hi {{name}},

Welcome to Villix. Your contributor profile is ready.

Open {{portal_url}} and sign in with this email address. We will send you a one-time verification code.

You will also be asked for the Shipd.ai username you use now or intend to create. You can update it later until an approved receipt matches it exactly.

Regards,
Villix`;

export function contributorPortalUrl() {
  return (process.env.PAYEE_PORTAL_ORIGIN || process.env.NEXT_PUBLIC_CONTRIBUTOR_PORTAL_URL || "https://contributor.villix.in").replace(/\/$/, "");
}

export function requireApplicationApiKey(request: Request) {
  const configured = process.env.CONTRIBUTOR_APPLICATION_API_KEY;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || configured.length < 32 || supplied.length !== configured.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

export async function findOrCreateApplicantUser(email: string) {
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const existing = data.users.find((user) => user.email?.toLowerCase() === email);
    if (existing) return existing;
    if (data.users.length < 1000) break;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { villix_portal: "contributor_applicant" },
  });
  if (error || !data.user) throw error ?? new Error("Could not provision contributor access.");
  return data.user as User;
}
