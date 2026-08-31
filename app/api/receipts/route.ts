import { addAudit, errorResponse, requireAdmin, safeJson } from "@/lib/villix-server";

type UploadedRow = { id?: string; name?: string; handle?: string; type?: string; gross?: number };

function isoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("The receipt date could not be read.");
  return parsed.toISOString().slice(0, 10);
}

async function sha256(buffer: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request) {
  let storagePath = "";
  let receiptId = "";
  try {
    const { actor, supabase } = await requireAdmin();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf")) {
      throw new Error("A PDF receipt is required.");
    }
    if (file.size > 15 * 1024 * 1024) throw new Error("Receipt PDFs must be smaller than 15 MB.");

    const rows = JSON.parse(String(form.get("rows") ?? "[]")) as UploadedRow[];
    if (!Array.isArray(rows) || !rows.length || rows.length > 500) {
      throw new Error("The receipt must contain between 1 and 500 contribution rows.");
    }

    const buffer = await file.arrayBuffer();
    const digest = await sha256(buffer);
    const { data: duplicate, error: duplicateError } = await supabase.from("receipts").select("id").eq("sha256", digest).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return Response.json({ error: "This receipt has already been imported." }, { status: 409 });

    const { data: peopleData, error: peopleError } = await supabase.from("people").select("id,handle").eq("status", "active");
    if (peopleError) throw peopleError;
    const people = new Map((peopleData ?? []).map((person) => [person.handle.toLowerCase(), person.id]));
    const issues = new Set<string>();
    const normalizedRows = rows.map((row) => {
      const handle = String(row.handle ?? "").trim().toLowerCase();
      const type = String(row.type ?? "").trim().toLowerCase();
      const grossCents = Math.round(Number(row.gross) * 100);
      if (!people.has(handle)) issues.add(`Unmatched handle ${handle || "(missing)"}`);
      if (!["problem", "bonus"].includes(type)) issues.add(`Unknown type ${type || "(missing)"}`);
      if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new Error("Every contribution amount must be a valid non-negative number.");
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
    const sourceTotalCents = Math.round(Number(form.get("sourceTotal")) * 100);
    if (!Number.isSafeInteger(sourceTotalCents) || sourceTotalCents < 0) throw new Error("The receipt total is invalid.");
    if (sourceTotalCents !== extractedTotalCents) throw new Error("The receipt total does not match the extracted contribution rows.");

    receiptId = crypto.randomUUID();
    const receiptDate = isoDate(String(form.get("receiptDate") ?? ""));
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
      payout_bps: row.type === "problem" ? 5000 : row.type === "bonus" ? 0 : null,
      payout_cents: row.type === "problem" ? Math.round(row.grossCents / 2) : row.type === "bonus" ? 0 : null,
    })));
    if (entriesError) throw entriesError;

    await addAudit(supabase, actor, "receipt.imported", "receipt", receiptId, "Receipt imported", `${file.name}: ${normalizedRows.length} rows and $${(extractedTotalCents / 100).toFixed(2)} verified.`, issues.size ? "warning" : "success");
    return Response.json({ id: receiptId, status, issues: [...issues] }, { status: 201 });
  } catch (error) {
    if (storagePath) {
      try {
        const { supabase } = await requireAdmin();
        if (receiptId) await supabase.from("receipts").delete().eq("id", receiptId);
        await supabase.storage.from("receipt-files").remove([storagePath]);
      } catch { /* best-effort rollback */ }
    }
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { actor, supabase } = await requireAdmin();
    const body = await request.json() as { id?: string; action?: string };
    if (body.action !== "approve" || !body.id) throw new Error("Unsupported receipt action.");
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
    await addAudit(supabase, actor, "receipt.approved", "receipt", body.id, `${receipt.filename} approved`, "The verified source rows are eligible for the next payout batch.", "success");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
