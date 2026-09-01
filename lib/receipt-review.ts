import type { VillixClient } from "@/lib/villix-server";

export async function reconcileReceipt(supabase: VillixClient, receiptId: string) {
  const [{ data: receipt, error: receiptError }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from("receipts").select("id,status").eq("id", receiptId).maybeSingle(),
    supabase.from("contribution_entries").select("source_handle,contributor_id,payout_bps").eq("receipt_id", receiptId),
  ]);
  if (receiptError) throw receiptError;
  if (entriesError) throw entriesError;
  if (!receipt) throw new Error("Receipt not found.");

  const issues = new Set<string>();
  for (const entry of entries ?? []) {
    if (!entry.contributor_id) issues.add(`Unmatched handle ${entry.source_handle}`);
    if (entry.payout_bps === null) issues.add("Unknown contribution type");
  }
  const nextStatus = issues.size ? "review" : "verified";
  if (receipt.status !== "approved") {
    const { error } = await supabase.from("receipts").update({ issues: [...issues], status: nextStatus }).eq("id", receiptId);
    if (error) throw error;
  }
  return { issues: [...issues], status: nextStatus };
}
