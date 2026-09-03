import { addAudit, errorResponse, requireAdmin, safeJson, type VillixClient } from "@/lib/villix-server";
import { parseReceiptPdf, ReceiptValidationError } from "@/lib/receipt-parser";
import { reconcileReceipt } from "@/lib/receipt-review";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function normalizedType(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z][a-z0-9_-]{1,39}$/.test(normalized) ? normalized : "unknown";
}

async function sha256(buffer: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

export async function POST(request: Request) {
  let storagePath = "";
  let receiptId = "";
  let supabaseClient: VillixClient | null = null;
  try {
    const { actor, supabase } = await requireAdmin();
    supabaseClient = supabase;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf")) {
      throw new ReceiptValidationError("A PDF receipt is required.");
    }
    if (file.size > 15 * 1024 * 1024) throw new ReceiptValidationError("Receipt PDFs must be smaller than 15 MB.");

    const buffer = await file.arrayBuffer();
    const digest = await sha256(buffer);
    const { data: duplicate, error: duplicateError } = await supabase.from("receipts").select("id").eq("sha256", digest).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return Response.json({ error: "This receipt has already been imported." }, { status: 409 });
    const parsedReceipt = await parseReceiptPdf(buffer);

    const [{ data: peopleData, error: peopleError }, { data: typesData, error: typesError }, { data: publishedVersion, error: versionError }] = await Promise.all([
      supabase.from("people").select("id,handle").eq("status", "active"),
      supabase.from("contribution_types").select("type,payout_bps").eq("active", true),
      supabase.from("rule_versions").select("version").eq("status", "published").single(),
    ]);
    if (peopleError) throw peopleError;
    if (typesError) throw typesError;
    if (versionError) throw versionError;
    const people = new Map((peopleData ?? []).map((person) => [person.handle.toLowerCase(), person.id]));
    const contributionTypes = new Map((typesData ?? []).map((type) => [type.type.toLowerCase(), type.payout_bps]));
    const issues = new Set<string>();
    const normalizedRows = parsedReceipt.rows.map((row) => {
      const handle = String(row.handle ?? "").trim().toLowerCase();
      const type = normalizedType(row.type);
      const grossCents = Math.round(Number(row.gross) * 100);
      if (!people.has(handle)) issues.add(`Unmatched handle ${handle || "(missing)"}`);
      if (!contributionTypes.has(type)) issues.add(`Unknown type ${type || "(missing)"}`);
      if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new ReceiptValidationError("Every contribution amount must be a valid non-negative number.");
      return {
        id: row.id || crypto.randomUUID(),
        name: String(row.name ?? "").trim(),
        handle,
        type,
        grossCents,
        contributorId: people.get(handle) ?? null,
      };
    });

    const extractedTotalCents = normalizedRows.reduce((total, row) => total + row.grossCents, 0);
    const sourceTotalCents = parsedReceipt.sourceTotalCents;
    if (sourceTotalCents !== extractedTotalCents) throw new ReceiptValidationError("The receipt total does not match the extracted contribution rows.");

    receiptId = crypto.randomUUID();
    const receiptDate = parsedReceipt.receiptDate;
    storagePath = `${receiptDate}/${receiptId}.pdf`;
    const { error: uploadError } = await supabase.storage.from("receipt-files").upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: false,
      metadata: { originalFilename: file.name, uploadedBy: actor.userId, sha256: digest },
    });
    if (uploadError) throw uploadError;

    const status = issues.size ? "review" : "verified";
    const { error: receiptError } = await supabase.from("receipts").insert({
      id: receiptId,
      filename: file.name,
      storage_path: storagePath,
      receipt_date: receiptDate,
      source_total_cents: sourceTotalCents,
      extracted_total_cents: extractedTotalCents,
      sha256: digest,
      status,
      issues: [...issues],
      imported_by: actor.userId,
    });
    if (receiptError) throw receiptError;

    const { error: entriesError } = await supabase.from("contribution_entries").insert(normalizedRows.map((row) => ({
      id: row.id,
      receipt_id: receiptId,
      contributor_id: row.contributorId,
      source_name: row.name,
      source_handle: row.handle,
      type: row.type,
      gross_cents: row.grossCents,
      payout_bps: contributionTypes.get(row.type) ?? null,
      payout_cents: contributionTypes.has(row.type) ? Math.round(row.grossCents * (contributionTypes.get(row.type)! / 10000)) : null,
      rule_version: publishedVersion.version,
    })));
    if (entriesError) throw entriesError;

    await addAudit(supabase, actor, "receipt.imported", "receipt", receiptId, "Receipt imported", `${file.name}: ${normalizedRows.length} rows and $${(extractedTotalCents / 100).toFixed(2)} verified.`, issues.size ? "warning" : "success");
    return Response.json({ id: receiptId, status, issues: [...issues] }, { status: 201 });
  } catch (error) {
    if (storagePath && supabaseClient) {
      try {
        if (receiptId) {
          const { error: entriesRollbackError } = await supabaseClient.from("contribution_entries").delete().eq("receipt_id", receiptId);
          if (entriesRollbackError) console.error("Receipt entry rollback failed", entriesRollbackError);
          const { error: receiptRollbackError } = await supabaseClient.from("receipts").delete().eq("id", receiptId);
          if (receiptRollbackError) console.error("Receipt rollback failed", receiptRollbackError);
        }
        const { error: storageRollbackError } = await supabaseClient.storage.from("receipt-files").remove([storagePath]);
        if (storageRollbackError) console.error("Receipt file rollback failed", storageRollbackError);
      } catch (rollbackError) {
        console.error("Receipt import rollback failed", rollbackError);
      }
    }
    if (error instanceof ReceiptValidationError) return Response.json({ error: error.message }, { status: 400 });
    if (databaseErrorCode(error) === "23505") return Response.json({ error: "This receipt has already been imported." }, { status: 409 });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as { id?: string; action?: string; handle?: string; personId?: string };
    if (!body.id) throw new ReceiptValidationError("Receipt ID is required.");

    if (body.action === "resolve_handle") {
      const handle = String(body.handle ?? "").trim().toLowerCase();
      const personId = String(body.personId ?? "");
      if (!/^@[a-z0-9_.-]{2,64}$/.test(handle) || !personId) throw new ReceiptValidationError("Choose a person for this receipt handle.");
      const { data: person, error: personError } = await supabase.from("people").select("id,display_name,handle,status").eq("id", personId).eq("status", "active").maybeSingle();
      if (personError) throw personError;
      if (!person) throw new ReceiptValidationError("The selected person is not active.");
      const { data: matchedEntries, error: matchError } = await supabase.from("contribution_entries").update({ contributor_id: person.id }).eq("receipt_id", body.id).eq("source_handle", handle).select("id");
      if (matchError) throw matchError;
      if (!matchedEntries?.length) throw new ReceiptValidationError("No unresolved entries use that handle.");
      const result = await reconcileReceipt(supabase, body.id);
      await addAudit(supabase, actor, "receipt.handle_resolved", "receipt", body.id, `${handle} matched`, `${matchedEntries.length} contribution rows were assigned to ${person.display_name} (${person.handle}).`, "success");
      return Response.json(result);
    }

    if (body.action !== "approve") throw new ReceiptValidationError("Unsupported receipt action.");
    const { data: receipt, error } = await supabase.from("receipts").select("filename,status,issues").eq("id", body.id).maybeSingle();
    if (error) throw error;
    if (!receipt) return Response.json({ error: "Receipt not found." }, { status: 404 });
    if (receipt.status === "review" || safeJson<unknown[]>(receipt.issues, []).length) throw new Error("Resolve every receipt issue before approval.");
    const { error: updateError } = await supabase.from("receipts").update({
      status: "approved",
      approved_by: actor.userId,
      approved_at: new Date().toISOString(),
    }).eq("id", body.id);
    if (updateError) throw updateError;
    const { data: approvedEntries, error: entriesError } = await supabase.from("contribution_entries").select("contributor_id,source_handle").eq("receipt_id", body.id).not("contributor_id", "is", null);
    if (entriesError) throw entriesError;
    const contributorIds = [...new Set((approvedEntries ?? []).map((entry) => entry.contributor_id).filter((id): id is string => Boolean(id)))];
    if (contributorIds.length) {
      const { data: contributors, error: contributorError } = await supabase.from("people").select("id,handle").in("id", contributorIds);
      if (contributorError) throw contributorError;
      const exactMatches = (contributors ?? []).filter((person) => approvedEntries?.some((entry) => entry.contributor_id === person.id && entry.source_handle.toLowerCase() === person.handle.toLowerCase())).map((person) => person.id);
      if (exactMatches.length) {
        const matchedAt = new Date().toISOString();
        const { error: matchPeopleError } = await supabase.from("people").update({ shipd_handle_status: "matched", shipd_handle_matched_at: matchedAt }).in("id", exactMatches);
        if (matchPeopleError) throw matchPeopleError;
        const { error: matchApplicationsError } = await supabase.from("contributor_applications").update({ shipd_handle_status: "matched" }).in("person_id", exactMatches);
        if (matchApplicationsError) throw matchApplicationsError;
      }
    }
    await addAudit(supabase, actor, "receipt.approved", "receipt", body.id, `${receipt.filename} approved`, "The verified source rows are eligible for the next payout batch.", "success");
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ReceiptValidationError) return Response.json({ error: error.message }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    if (actor.role === "reviewer") return Response.json({ error: "Only an administrator can delete a receipt." }, { status: 403 });
    const body = await request.json() as { id?: string };
    const receiptId = String(body.id ?? "");
    if (!receiptId) throw new ReceiptValidationError("Receipt ID is required.");

    // Authorization is performed above with the signed-in administrator. Use the
    // server-only client for the destructive operation so storage and database
    // cleanup do not depend on a browser session's RLS policy cache.
    const admin = createAdminClient();

    const [{ data: receipt, error: receiptError }, { data: entries, error: entriesError }] = await Promise.all([
      admin.from("receipts").select("*").eq("id", receiptId).maybeSingle(),
      admin.from("contribution_entries").select("*").eq("receipt_id", receiptId),
    ]);
    if (receiptError) throw receiptError;
    if (entriesError) throw entriesError;
    if (!receipt) return Response.json({ error: "Receipt not found." }, { status: 404 });
    if (receipt.status === "approved") return Response.json({ error: "Approved receipts are locked and cannot be deleted." }, { status: 409 });

    const { data: deletedEntries, error: deleteEntriesError } = await admin
      .from("contribution_entries")
      .delete()
      .eq("receipt_id", receiptId)
      .select("id");
    if (deleteEntriesError) throw deleteEntriesError;
    if ((deletedEntries?.length ?? 0) !== (entries?.length ?? 0)) {
      throw new Error("Receipt entries could not be deleted completely.");
    }

    const { data: deletedReceipt, error: deleteReceiptError } = await admin
      .from("receipts")
      .delete()
      .eq("id", receiptId)
      .select("id")
      .maybeSingle();
    if (deleteReceiptError) {
      const { error: restoreEntriesError } = await admin.from("contribution_entries").insert(entries ?? []);
      if (restoreEntriesError) console.error("Could not restore receipt entries after a failed delete", restoreEntriesError);
      throw deleteReceiptError;
    }
    if (!deletedReceipt) {
      const { error: restoreEntriesError } = await admin.from("contribution_entries").insert(entries ?? []);
      if (restoreEntriesError) console.error("Could not restore receipt entries after a missing receipt delete", restoreEntriesError);
      throw new Error("Receipt could not be deleted.");
    }

    const { error: storageError } = await admin.storage.from("receipt-files").remove([receipt.storage_path]);
    if (storageError) {
      const { error: restoreReceiptError } = await admin.from("receipts").insert(receipt);
      const { error: restoreEntriesError } = restoreReceiptError ? { error: null } : await admin.from("contribution_entries").insert(entries ?? []);
      if (restoreReceiptError) console.error("Could not restore receipt after file deletion failed", restoreReceiptError);
      if (restoreEntriesError) console.error("Could not restore receipt entries after file deletion failed", restoreEntriesError);
      throw storageError;
    }

    try {
      await addAudit(supabase, actor, "receipt.deleted", "receipt", receiptId, `${receipt.filename} deleted`, `${entries?.length ?? 0} contribution rows and the private PDF were removed.`, "warning");
    } catch (auditError) {
      console.error("Receipt deletion audit could not be recorded", auditError);
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ReceiptValidationError) return Response.json({ error: error.message }, { status: 400 });
    return errorResponse(error);
  }
}
