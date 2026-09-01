import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

async function listUsersByEmail() {
  const admin = createAdminClient();
  const users = new Map<string, User>();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) users.set(user.email.toLowerCase(), user);
    }
    if (data.users.length < 1000) break;
  }
  return users;
}

async function createOrFindUser(email: string, users: Map<string, User>): Promise<User> {
  const existing = users.get(email);
  if (existing) return existing;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { villix_portal: "payee" },
  });
  if (error || !data.user) throw error ?? new Error("Supabase did not create the payee account.");
  users.set(email, data.user);
  return data.user;
}

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot invite payout recipients." }, { status: 403 });
    if (!process.env.SUPABASE_SECRET_KEY) return Response.json({ error: "Add the Supabase server secret before enabling the payee portal." }, { status: 409 });

    const body = await request.json() as Record<string, unknown>;
    const requestedIds = Array.isArray(body.personIds) ? body.personIds : [body.personId];
    const personIds = [...new Set(requestedIds.map((value) => String(value ?? "")).filter(Boolean))];
    if (!personIds.length) return Response.json({ error: "Choose at least one payout recipient." }, { status: 400 });
    if (personIds.length > 100) return Response.json({ error: "Invite no more than 100 recipients at once." }, { status: 400 });

    const { data: people, error: personError } = await supabase.from("people").select("id,display_name,email,role,team_lead_id,status").in("id", personIds);
    if (personError) throw personError;
    if (!people || people.length !== personIds.length) return Response.json({ error: "One or more recipients could not be found." }, { status: 404 });
    for (const person of people) {
      if (person.status !== "active") return Response.json({ error: `Activate ${person.display_name} before enabling contributor access.` }, { status: 409 });
      if (person.role === "admin") return Response.json({ error: "Administrators are not payout recipients." }, { status: 409 });
      if (person.role === "contributor" && person.team_lead_id) {
        return Response.json({ error: `${person.display_name} is paid through a team leader. Enable the team leader instead.` }, { status: 409 });
      }
    }

    const { data: existingAccounts, error: accountError } = await supabase.from("payee_portal_accounts").select("person_id,status").in("person_id", personIds);
    if (accountError) throw accountError;
    const accountStatus = new Map((existingAccounts ?? []).map((account) => [account.person_id, account.status]));
    const users = await listUsersByEmail();
    const invitedAt = new Date().toISOString();
    const accessRows = [];
    for (const person of people) {
      if (accountStatus.get(person.id) === "active") continue;
      const email = String(person.email).toLowerCase();
      const user = await createOrFindUser(email, users);
      accessRows.push({ person_id: person.id, user_id: user.id, status: "invited" as const, invited_at: invitedAt, created_by: actor.userId });
    }
    const { error: accessError } = accessRows.length
      ? await supabase.from("payee_portal_accounts").upsert(accessRows, { onConflict: "person_id" })
      : { error: null };
    if (accessError) throw accessError;
    const { error: profileError } = await supabase.from("payee_profiles").update({ onboarding_status: "pending", payout_provider: "razorpayx" }).in("person_id", personIds).neq("onboarding_status", "ready");
    if (profileError) throw profileError;

    const changedIds = new Set(accessRows.map((row) => row.person_id));
    for (const person of people.filter((candidate) => changedIds.has(candidate.id))) {
      await addAudit(supabase, actor, "payee.portal_invited", "person", person.id, `${person.display_name} portal access enabled`, "Contributor portal access was provisioned. The recipient must open contributor.villix.in and request their own one-time sign-in code.", "success");
    }
    const portalUrl = process.env.PAYEE_PORTAL_ORIGIN?.replace(/\/$/, "") || "https://contributor.villix.in";
    return Response.json({ ok: true, recipients: people.length, enabled: accessRows.length, portalUrl });
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
