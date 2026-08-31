import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

const roles = new Map([["Contributor", "contributor"], ["Team lead", "team_lead"], ["Admin", "admin"]]);
const statuses = new Map([["Active", "active"], ["Paused", "paused"]]);

function normalizedHandle(value: unknown) {
  const handle = String(value ?? "").trim();
  const result = handle.startsWith("@") ? handle : `@${handle}`;
  if (!/^@[A-Za-z0-9_.-]{2,64}$/.test(result)) throw new Error("Enter a valid unique receipt handle.");
  return result;
}

export async function POST(request: Request) {
  let personId = "";
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const handle = normalizedHandle(body.handle);
    const role = roles.get(String(body.role));
    const teamLeadId = role === "contributor" && body.teamLeadId ? String(body.teamLeadId) : null;
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !role) throw new Error("Name, email, handle, and role are required.");
    if (teamLeadId) {
      const { data: lead, error } = await supabase.from("people").select("id").eq("id", teamLeadId).eq("role", "team_lead").eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!lead) throw new Error("The selected team lead is not active.");
    }
    const payoutMethod = role === "team_lead" ? "team" : role === "admin" ? "none" : teamLeadId ? "contractor" : "direct";
    const { data: person, error: personError } = await supabase.from("people").insert({ display_name: name, handle, email, role, team_lead_id: teamLeadId, payout_method: payoutMethod }).select("id").single();
    if (personError) throw personError;
    personId = person.id;
    const { error: profileError } = await supabase.from("payee_profiles").insert({ person_id: personId, legal_name: name });
    if (profileError) throw profileError;
    if (role === "contributor") {
      const { error } = await supabase.from("team_assignments").insert({ contributor_id: personId, team_lead_id: teamLeadId, effective_from: new Date().toISOString().slice(0, 10), changed_by: actor.userId });
      if (error) throw error;
    }
    await addAudit(supabase, actor, "person.created", "person", personId, `${name} added`, `${body.role} created with handle ${handle}.`, "success");
    return Response.json({ id: personId }, { status: 201 });
  } catch (error) {
    if (personId) { try { const { supabase } = await requireAdmin(); await supabase.from("people").delete().eq("id", personId); } catch { /* best-effort rollback */ } }
    const message = typeof error === "object" && error && "code" in error && error.code === "23505" ? "That receipt handle or email is already in use." : null;
    return message ? Response.json({ error: message }, { status: 409 }) : errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    const { data: current, error: currentError } = await supabase.from("people").select("id,display_name,role,team_lead_id,status").eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return Response.json({ error: "Person not found." }, { status: 404 });

    const role = body.role === undefined ? current.role : roles.get(String(body.role));
    const status = body.status === undefined ? current.status : statuses.get(String(body.status));
    if (!role || !status) throw new Error("Unsupported role or status.");
    const teamLeadId = role === "contributor" ? (body.teamLeadId === undefined ? current.team_lead_id : body.teamLeadId ? String(body.teamLeadId) : null) : null;
    if (teamLeadId === id) throw new Error("A contributor cannot report to themselves.");
    if (teamLeadId) {
      const { data: lead, error } = await supabase.from("people").select("id").eq("id", teamLeadId).eq("role", "team_lead").eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!lead) throw new Error("The selected team lead is not active.");
    }
    const payoutMethod = role === "team_lead" ? "team" : role === "admin" ? "none" : teamLeadId ? "contractor" : "direct";
    const { error: updateError } = await supabase.from("people").update({ role, team_lead_id: teamLeadId, status, payout_method: payoutMethod }).eq("id", id);
    if (updateError) throw updateError;
    if (role === "contributor" && teamLeadId !== current.team_lead_id) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const { error: closeError } = await supabase.from("team_assignments").update({ effective_to: yesterday }).eq("contributor_id", id).is("effective_to", null);
      if (closeError) throw closeError;
      const { error: assignmentError } = await supabase.from("team_assignments").insert({ contributor_id: id, team_lead_id: teamLeadId, effective_from: new Date().toISOString().slice(0, 10), changed_by: actor.userId });
      if (assignmentError) throw assignmentError;
    }
    await addAudit(supabase, actor, "person.updated", "person", id, `${current.display_name} updated`, "Role, team assignment, or status changed in the directory.");
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
