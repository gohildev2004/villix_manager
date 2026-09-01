import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicOrigin } from "@/lib/public-origin";
import { contributorPortalConfirmUrl } from "@/lib/contributor-portal";
import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

async function findUserByEmail(email: string) {
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function createOrFindUser(email: string): Promise<User> {
  const existing = await findUserByEmail(email);
  if (existing) return existing;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { villix_portal: "payee" },
  });
  if (error || !data.user) throw error ?? new Error("Supabase did not create the payee account.");
  return data.user;
}

async function sendPortalCode(email: string, request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase email authentication is not configured.");
  const origin = process.env.PAYEE_PORTAL_ORIGIN?.replace(/\/$/, "") || publicOrigin(request);
  const supabase = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: contributorPortalConfirmUrl(origin) },
  });
  if (error) throw error;
}

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot invite payout recipients." }, { status: 403 });
    if (!process.env.SUPABASE_SECRET_KEY) return Response.json({ error: "Add the Supabase server secret before enabling the payee portal." }, { status: 409 });

    const body = await request.json() as Record<string, unknown>;
    const personId = String(body.personId ?? "");
    const { data: person, error: personError } = await supabase.from("people").select("id,display_name,email,role,team_lead_id,status").eq("id", personId).maybeSingle();
    if (personError) throw personError;
    if (!person) return Response.json({ error: "Person not found." }, { status: 404 });
    if (person.status !== "active") return Response.json({ error: "Activate this person before inviting them to the payee portal." }, { status: 409 });
    if (person.role === "admin") return Response.json({ error: "Administrators are not payout recipients." }, { status: 409 });
    if (person.role === "contributor" && person.team_lead_id) {
      return Response.json({ error: "This contributor is paid through their team leader. Invite the team leader instead." }, { status: 409 });
    }

    const user = await createOrFindUser(String(person.email).toLowerCase());
    const { error: accessError } = await supabase.from("payee_portal_accounts").upsert({
      person_id: person.id,
      user_id: user.id,
      status: "invited",
      invited_at: new Date().toISOString(),
      created_by: actor.userId,
    }, { onConflict: "person_id" });
    if (accessError) throw accessError;
    const { error: profileError } = await supabase.from("payee_profiles").update({ onboarding_status: "pending", payout_provider: "razorpayx" }).eq("person_id", person.id).neq("onboarding_status", "ready");
    if (profileError) throw profileError;

    await sendPortalCode(String(person.email).toLowerCase(), request);
    await addAudit(supabase, actor, "payee.portal_invited", "person", person.id, `${person.display_name} invited`, "Payee portal access was enabled and a one-time sign-in code was sent. No bank details were collected by Villix.", "success");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot change payee access." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const personId = String(body.personId ?? "");
    const { data: person, error: personError } = await supabase.from("people").select("id,display_name").eq("id", personId).maybeSingle();
    if (personError) throw personError;
    if (!person) return Response.json({ error: "Person not found." }, { status: 404 });
    const { error } = await supabase.from("payee_portal_accounts").update({ status: "suspended" }).eq("person_id", personId);
    if (error) throw error;
    await addAudit(supabase, actor, "payee.portal_suspended", "person", person.id, `${person.display_name} portal access suspended`, "The recipient can no longer open the Villix Payee Portal.", "warning");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
