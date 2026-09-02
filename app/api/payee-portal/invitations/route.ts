import { invitationEmailConfigured, sendInvitationEmail } from "@/lib/invitation-email";
import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot email payout recipients." }, { status: 403 });
    if (!invitationEmailConfigured()) {
      return Response.json({ error: "Invitation email is not configured. Add the invitation SMTP variables in Render first." }, { status: 409 });
    }

    const body = await request.json() as Record<string, unknown>;
    const personIds = [...new Set((Array.isArray(body.personIds) ? body.personIds : []).map((value) => String(value ?? "")).filter(Boolean))];
    const subject = String(body.subject ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!personIds.length) return Response.json({ error: "Choose at least one payout recipient." }, { status: 400 });
    if (personIds.length > 25) return Response.json({ error: "Send no more than 25 invitations at once." }, { status: 400 });
    if (!subject || subject.length > 160 || /[\r\n]/.test(subject)) return Response.json({ error: "Use a one-line subject of 160 characters or fewer." }, { status: 400 });
    if (!message || message.length > 5000) return Response.json({ error: "Use a message of 5,000 characters or fewer." }, { status: 400 });

    const { data: people, error: personError } = await supabase
      .from("people")
      .select("id,display_name,email,role,team_lead_id,status,payee_portal_accounts(status)")
      .in("id", personIds);
    if (personError) throw personError;
    if (!people || people.length !== personIds.length) return Response.json({ error: "One or more recipients could not be found." }, { status: 404 });

    for (const person of people) {
      if (person.status !== "active" || person.role === "admin" || (person.role === "contributor" && person.team_lead_id)) {
        return Response.json({ error: `${person.display_name} is not an active direct payout recipient.` }, { status: 409 });
      }
      const portal = Array.isArray(person.payee_portal_accounts) ? person.payee_portal_accounts[0] : person.payee_portal_accounts;
      if (!portal || portal.status === "suspended") {
        return Response.json({ error: `Enable contributor portal access for ${person.display_name} before sending an invitation.` }, { status: 409 });
      }
    }

    const portalUrl = process.env.PAYEE_PORTAL_ORIGIN?.replace(/\/$/, "") || "https://contributor.villix.in";
    const failedPersonIds: string[] = [];
    let sent = 0;
    for (const person of people) {
      try {
        await sendInvitationEmail({
          recipient: { name: person.display_name, email: person.email },
          subjectTemplate: subject,
          messageTemplate: message,
          portalUrl,
        });
        sent += 1;
        try {
          await addAudit(supabase, actor, "payee.invitation_emailed", "person", person.id, `${person.display_name} invitation emailed`, `Contributor portal invitation sent to ${person.email}. Subject: ${subject}`, "success");
        } catch (auditError) {
          console.error(`Invitation audit failed for person ${person.id}`, auditError);
        }
      } catch (error) {
        console.error(`Invitation delivery failed for person ${person.id}`, error);
        failedPersonIds.push(person.id);
      }
    }

    return Response.json({ ok: failedPersonIds.length === 0, sent, failed: failedPersonIds.length, failedPersonIds });
  } catch (error) {
    return errorResponse(error);
  }
}
