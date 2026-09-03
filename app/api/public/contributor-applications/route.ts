import { contributorInvitationMessage, contributorInvitationSubject, contributorPortalUrl, findOrCreateApplicantUser, requireApplicationApiKey } from "@/lib/contributor-applications";
import { sendInvitationEmail } from "@/lib/invitation-email";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number) { return String(value ?? "").trim().slice(0, max); }

export async function POST(request: Request) {
  try {
    requireApplicationApiKey(request);
    const body = await request.json() as Record<string, unknown>;
    if (text(body.website, 200)) return Response.json({ ok: true }, { status: 202 });
    const firstName = text(body.firstName, 60);
    const lastName = text(body.lastName, 60);
    const email = text(body.email, 254).toLowerCase();
    const teamLeadId = text(body.teamLeadId, 64);
    const source = text(body.source, 80) || "villix_landing_page";
    if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(email) || !teamLeadId) {
      return Response.json({ error: "First name, last name, email, and team leader are required." }, { status: 400 });
    }

    const admin = createAdminClient();
    const [{ data: lead, error: leadError }, { data: existingPerson, error: personError }, { data: existingApplication, error: existingApplicationError }] = await Promise.all([
      admin.from("people").select("id,display_name").eq("id", teamLeadId).eq("role", "team_lead").eq("status", "active").maybeSingle(),
      admin.from("people").select("id").eq("email", email).maybeSingle(),
      admin.from("contributor_applications").select("id,status,person_id,auth_user_id").eq("email", email).maybeSingle(),
    ]);
    if (leadError) throw leadError;
    if (personError) throw personError;
    if (existingApplicationError) throw existingApplicationError;
    if (!lead) return Response.json({ error: "Choose an available Villix team leader." }, { status: 409 });
    if (existingPerson) return Response.json({ error: "This email already has a Villix profile. Contact an administrator." }, { status: 409 });
    if (existingApplication?.status === "declined") return Response.json({ error: "This application cannot be reopened. Contact Villix." }, { status: 409 });
    if (existingApplication?.person_id || existingApplication?.status === "profile_complete") return Response.json({ error: "This application is already complete. Sign in at contributor.villix.in." }, { status: 409 });

    const user = await findOrCreateApplicantUser(email);
    const { data: application, error: applicationError } = await admin.from("contributor_applications").upsert({
      first_name: firstName,
      last_name: lastName,
      email,
      team_lead_id: teamLeadId,
      auth_user_id: user.id,
      status: "submitted",
      invitation_status: "pending",
      last_error: null,
      source,
    }, { onConflict: "email" }).select("id,status").single();
    if (applicationError) throw applicationError;
    try {
      await sendInvitationEmail({
        recipient: { email, name: firstName },
        subjectTemplate: contributorInvitationSubject,
        messageTemplate: contributorInvitationMessage,
        portalUrl: contributorPortalUrl(),
      });
      await admin.from("contributor_applications").update({ status: "invited", invitation_status: "sent", invitation_sent_at: new Date().toISOString(), last_error: null }).eq("id", application.id);
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message.slice(0, 500) : "Email delivery failed";
      await admin.from("contributor_applications").update({ invitation_status: "failed", last_error: message }).eq("id", application.id);
      console.error("Contributor invitation failed", emailError);
      return Response.json({ error: "Your application was saved, but the invitation email could not be sent. Villix will retry it." }, { status: 503 });
    }
    return Response.json({ ok: true, applicationId: application.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Contributor application failed", error);
    return Response.json({ error: "The application could not be submitted. Please try again." }, { status: 500 });
  }
}
