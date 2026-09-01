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
    const currency = "INR";
    const teamLeadId = role === "contributor" && body.teamLeadId ? String(body.teamLeadId) : null;
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !role) throw new Error("Name, email, handle, and role are required.");
    if (teamLeadId) {
      const { data: lead, error } = await supabase.from("people").select("id").eq("id", teamLeadId).eq("role", "team_lead").eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!lead) throw new Error("The selected team lead is not active.");
    }
    const payoutMethod = role === "team_lead" ? "team" : role === "admin" ? "none" : teamLeadId ? "contractor" : "direct";
    const { data: person, error: personError } = await supabase.from("people").insert({ display_name: name, handle, email, role, team_lead_id: teamLeadId, payout_method: payoutMethod, currency }).select("id").single();
    if (personError) throw personError;
    personId = person.id;
    const { error: profileError } = await supabase.from("payee_profiles").insert({ person_id: personId, legal_name: name, country: "IN", currency: "INR", payout_provider: "razorpayx" });
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
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot update people." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    const { data: current, error: currentError } = await supabase.from("people").select("id,display_name,handle,email,role,team_lead_id,status,currency").eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return Response.json({ error: "Person not found." }, { status: 404 });

    const name = body.name === undefined ? current.display_name : String(body.name).trim();
    const email = body.email === undefined ? current.email : String(body.email).trim().toLowerCase();
    const handle = body.handle === undefined ? current.handle : normalizedHandle(body.handle);
    if (name.length < 2 || name.length > 120) throw new Error("Enter a name between 2 and 120 characters.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
    const role = body.role === undefined ? current.role : roles.get(String(body.role));
    const status = body.status === undefined ? current.status : statuses.get(String(body.status));
    const currency = "INR";
    if (!role || !status) throw new Error("Unsupported role or status.");
    const teamLeadId = role === "contributor" ? (body.teamLeadId === undefined ? current.team_lead_id : body.teamLeadId ? String(body.teamLeadId) : null) : null;
    if (teamLeadId === id) throw new Error("A contributor cannot report to themselves.");
    if (teamLeadId) {
      const { data: lead, error } = await supabase.from("people").select("id").eq("id", teamLeadId).eq("role", "team_lead").eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!lead) throw new Error("The selected team lead is not active.");
    }
    if (current.role === "team_lead" && role !== "team_lead") {
      const { count, error } = await supabase.from("people").select("id", { count: "exact", head: true }).eq("team_lead_id", id);
      if (error) throw error;
      if (count) return Response.json({ error: "Reassign this team lead’s contributors before changing their role." }, { status: 409 });
    }
    const payoutMethod = role === "team_lead" ? "team" : role === "admin" ? "none" : teamLeadId ? "contractor" : "direct";
    const { error: updateError } = await supabase.from("people").update({ display_name: name, email, handle, role, team_lead_id: teamLeadId, status, payout_method: payoutMethod, currency }).eq("id", id);
    if (updateError) throw updateError;
    const { error: profileError } = await supabase.from("payee_profiles").update({ currency }).eq("person_id", id);
    if (profileError) throw profileError;
    const assignmentChanged = role !== current.role || teamLeadId !== current.team_lead_id;
    if (current.role === "contributor" && assignmentChanged) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: currentAssignment, error: assignmentQueryError } = await supabase.from("team_assignments").select("id,effective_from").eq("contributor_id", id).is("effective_to", null).maybeSingle();
      if (assignmentQueryError) throw assignmentQueryError;
      if (currentAssignment?.effective_from === today) {
        const { error } = await supabase.from("team_assignments").delete().eq("id", currentAssignment.id);
        if (error) throw error;
      } else if (currentAssignment) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const { error } = await supabase.from("team_assignments").update({ effective_to: yesterday }).eq("id", currentAssignment.id);
        if (error) throw error;
      }
    }
    if (role === "contributor" && assignmentChanged) {
      const { error: assignmentError } = await supabase.from("team_assignments").insert({ contributor_id: id, team_lead_id: teamLeadId, effective_from: new Date().toISOString().slice(0, 10), changed_by: actor.userId });
      if (assignmentError) throw assignmentError;
    }
    await addAudit(supabase, actor, "person.updated", "person", id, `${name} updated`, "Identity, contact, role, team assignment, or status details changed in the directory.");
    return Response.json({ ok: true });
  } catch (error) {
    const duplicate = typeof error === "object" && error && "code" in error && error.code === "23505";
    return duplicate ? Response.json({ error: "That receipt handle or email is already in use." }, { status: 409 }) : errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot remove people." }, { status: 403 });

    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    if (!id) return Response.json({ error: "Choose a person to remove." }, { status: 400 });

    const { data: person, error: personError } = await supabase
      .from("people")
      .select("id,display_name,role")
      .eq("id", id)
      .maybeSingle();
    if (personError) throw personError;
    if (!person) return Response.json({ error: "Person not found." }, { status: 404 });
    if (person.role === "admin") return Response.json({ error: "Administrator records cannot be removed from the People directory." }, { status: 409 });

    const [entries, recipients, members, ledAssignments] = await Promise.all([
      supabase.from("contribution_entries").select("id", { count: "exact", head: true }).eq("contributor_id", id),
      supabase.from("payout_recipients").select("id", { count: "exact", head: true }).eq("person_id", id),
      supabase.from("people").select("id", { count: "exact", head: true }).eq("team_lead_id", id),
      supabase.from("team_assignments").select("id", { count: "exact", head: true }).eq("team_lead_id", id),
    ]);
    for (const result of [entries, recipients, members, ledAssignments]) if (result.error) throw result.error;

    const blockers: string[] = [];
    if (entries.count) blockers.push(`${entries.count} contribution entr${entries.count === 1 ? "y" : "ies"}`);
    if (recipients.count) blockers.push(`${recipients.count} payout record${recipients.count === 1 ? "" : "s"}`);
    if (members.count) blockers.push(`${members.count} assigned team member${members.count === 1 ? "" : "s"}`);
    if (ledAssignments.count && !members.count) blockers.push("historical team assignments");
    if (blockers.length) {
      return Response.json({
        error: `${person.display_name} cannot be removed because they have ${blockers.join(", ")}. Pause the person instead, or remove/reassign the linked records first.`,
      }, { status: 409 });
    }

    const { error: assignmentError } = await supabase.from("team_assignments").delete().eq("contributor_id", id);
    if (assignmentError) throw assignmentError;
    const { error: profileError } = await supabase.from("payee_profiles").delete().eq("person_id", id);
    if (profileError) throw profileError;
    const { error: deleteError } = await supabase.from("people").delete().eq("id", id);
    if (deleteError) throw deleteError;

    await addAudit(supabase, actor, "person.removed", "person", id, `${person.display_name} removed`, "The unreferenced directory record and payee profile were permanently removed.", "warning");
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
