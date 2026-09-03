import { contributorInvitationMessage, contributorInvitationSubject, contributorPortalUrl } from "@/lib/contributor-applications";
import { sendInvitationEmail } from "@/lib/invitation-email";
import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as { id?: string; action?: "resend" | "decline" };
    if (!body.id || !body.action) return Response.json({ error: "Application and action are required." }, { status: 400 });

    const { data: application, error } = await supabase.from("contributor_applications")
      .select("id,first_name,last_name,email,status,person_id")
      .eq("id", body.id)
      .single();
    if (error) throw error;

    if (body.action === "decline") {
      if (application.person_id || application.status === "profile_complete") {
        return Response.json({ error: "A completed contributor profile cannot be declined. Pause or remove the person from People instead." }, { status: 409 });
      }
      const { error: updateError } = await supabase.from("contributor_applications")
        .update({ status: "declined", last_error: null })
        .eq("id", application.id);
      if (updateError) throw updateError;
      await addAudit(supabase, actor, "contributor_application_declined", "contributor_application", application.id, "Contributor application declined", `${application.first_name} ${application.last_name} · ${application.email}`, "warning");
      return Response.json({ ok: true });
    }

    if (application.status === "declined") return Response.json({ error: "Declined applications cannot receive invitations." }, { status: 409 });
    await sendInvitationEmail({
      recipient: { email: application.email, name: application.first_name },
      subjectTemplate: contributorInvitationSubject,
      messageTemplate: contributorInvitationMessage,
      portalUrl: contributorPortalUrl(),
    });
    const sentAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("contributor_applications")
      .update({ status: application.status === "submitted" ? "invited" : application.status, invitation_status: "sent", invitation_sent_at: sentAt, last_error: null })
      .eq("id", application.id);
    if (updateError) throw updateError;
    await addAudit(supabase, actor, "contributor_application_invited", "contributor_application", application.id, "Contributor invitation sent", `${application.first_name} ${application.last_name} · ${application.email}`, "success");
    return Response.json({ ok: true, sentAt });
  } catch (error) { return errorResponse(error); }
}
