import { requirePayee } from "@/lib/payee-server";
import { normalizeShipdHandle } from "@/lib/shipd-handle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { admin, payee } = await requirePayee();
    const body = await request.json() as Record<string, unknown>;
    const handle = normalizeShipdHandle(body.handle);

    if (!payee.personId) {
      if (!payee.applicationId) return Response.json({ error: "Contributor application not found." }, { status: 404 });
      const { data, error } = await admin.rpc("complete_contributor_application", {
        target_application_id: payee.applicationId,
        target_auth_user_id: payee.userId,
        target_handle: handle,
      });
      if (error) throw error;
      return Response.json({ ok: true, personId: data });
    }

    const { data: person, error: personError } = await admin.from("people").select("id,shipd_handle_status").eq("id", payee.personId).single();
    if (personError) throw personError;
    if (person.shipd_handle_status === "matched") return Response.json({ error: "This username is locked. Ask a Villix administrator to change it." }, { status: 409 });
    const { error: updateError } = await admin.from("people").update({ handle, shipd_handle_status: "claimed", shipd_handle_matched_at: null }).eq("id", payee.personId);
    if (updateError) throw updateError;
    await admin.from("contributor_applications").update({ shipd_handle: handle, shipd_handle_status: "claimed" }).eq("person_id", payee.personId);
    return Response.json({ ok: true });
  } catch (error) {
    const duplicate = typeof error === "object" && error && "code" in error && String(error.code) === "23505";
    const message = duplicate ? "That Shipd.ai username is already connected to another Villix profile." : error instanceof Error ? error.message : "The username could not be saved.";
    return Response.json({ error: message }, { status: duplicate ? 409 : 400 });
  }
}
