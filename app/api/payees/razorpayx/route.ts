import { createRazorpayxContact, createRazorpayxFundAccount, razorpayxConfigured } from "@/lib/razorpayx";
import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Reviewers cannot configure payout accounts." }, { status: 403 });
    if (!razorpayxConfigured()) return Response.json({ error: "Add the RazorpayX server credentials before onboarding a beneficiary." }, { status: 409 });

    const body = await request.json() as Record<string, unknown>;
    const personId = String(body.personId ?? "");
    const legalName = String(body.legalName ?? "").trim();
    const accountNumber = String(body.accountNumber ?? "").replace(/\s+/g, "");
    const ifsc = String(body.ifsc ?? "").trim().toUpperCase();
    if (!personId || legalName.length < 2 || legalName.length > 120) throw new Error("Enter the beneficiary’s legal bank-account name.");
    if (!/^\d{6,34}$/.test(accountNumber)) throw new Error("Enter a valid Indian bank account number.");
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error("Enter a valid 11-character IFSC code.");

    const { data: person, error: personError } = await supabase
      .from("people")
      .select("id,display_name,email,role,team_lead_id,payee_profiles(provider_contact_id)")
      .eq("id", personId)
      .maybeSingle();
    if (personError) throw personError;
    if (!person) return Response.json({ error: "Person not found." }, { status: 404 });
    if (person.role === "admin") return Response.json({ error: "Administrators are not payout recipients." }, { status: 409 });
    if (person.role === "contributor" && person.team_lead_id) {
      return Response.json({ error: "This contributor’s payable amount routes to their team lead. Configure the team lead’s bank account instead." }, { status: 409 });
    }

    const embeddedProfile = Array.isArray(person.payee_profiles) ? person.payee_profiles[0] : person.payee_profiles;
    let contactId = embeddedProfile?.provider_contact_id ?? null;
    if (!contactId) {
      const contact = await createRazorpayxContact({ name: legalName, email: person.email, referenceId: person.id });
      contactId = contact.id;
      const { error: contactSaveError } = await supabase.from("payee_profiles").update({
        provider_contact_id: contactId,
        legal_name: legalName,
        payout_provider: "razorpayx",
        onboarding_status: "pending",
      }).eq("person_id", person.id);
      if (contactSaveError) throw contactSaveError;
    }

    const fundAccount = await createRazorpayxFundAccount({ contactId, legalName, accountNumber, ifsc });
    const bankLast4 = accountNumber.slice(-4);
    const { error: profileError } = await supabase.from("payee_profiles").update({
      provider_contact_id: contactId,
      provider_recipient_id: fundAccount.id,
      legal_name: legalName,
      bank_last4: bankLast4,
      ifsc,
      country: "IN",
      currency: "INR",
      payout_provider: "razorpayx",
      onboarding_status: "ready",
    }).eq("person_id", person.id);
    if (profileError) throw profileError;

    await addAudit(supabase, actor, "payee.razorpayx_connected", "person", person.id, `${person.display_name} connected to RazorpayX`, `Indian bank beneficiary ending ${bankLast4} was verified and tokenized by RazorpayX. The full account number was not stored.`, "success");
    return Response.json({ ok: true, bankLast4, fundAccountId: fundAccount.id });
  } catch (error) {
    return errorResponse(error);
  }
}
