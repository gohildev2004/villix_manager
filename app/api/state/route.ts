import { errorResponse, requireAdmin, safeJson } from "@/lib/villix-server";
import { isPayoutWeekday } from "@/lib/payout-schedule";

export const dynamic = "force-dynamic";

function role(value: string) { return value === "team_lead" ? "Team lead" : value === "admin" ? "Admin" : "Contributor"; }
function titleStatus(value: string) { return value === "approved" ? "Approved" : value === "verified" ? "Verified" : "Needs review"; }
function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export async function GET() {
  try {
    const { actor, supabase } = await requireAdmin();
    const [peopleQuery, entriesQuery, receiptEntriesQuery, receiptsQuery, auditQuery, batchQuery, ruleVersionsQuery, rulesQuery, settingsQuery] = await Promise.all([
      supabase.from("people").select("*").order("display_name"),
      supabase.from("contribution_entries").select("*, receipts!inner(filename,receipt_date,status)").in("receipts.status", ["verified", "approved"]).order("created_at"),
      supabase.from("contribution_entries").select("*, receipts!inner(filename,receipt_date,status)").order("created_at"),
      supabase.from("receipts").select("*, contribution_entries(count)").order("receipt_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("payout_batches").select("id,status,payout_date,payout_recipients(person_id,status)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("rule_versions").select("version,status,effective_from,created_at,published_at").order("version", { ascending: false }),
      supabase.from("contribution_rules").select("version,type,label,description,payout_bps,active").order("type"),
      supabase.from("workspace_settings").select("value").eq("key", "payout_policy").maybeSingle(),
    ]);
    for (const query of [peopleQuery, entriesQuery, receiptEntriesQuery, receiptsQuery, auditQuery, batchQuery, ruleVersionsQuery, rulesQuery, settingsQuery]) if (query.error) throw query.error;

    const people = (peopleQuery.data ?? []).map((person) => ({
      id: person.id,
      name: person.display_name,
      handle: person.handle,
      email: person.email,
      role: role(person.role),
      teamLeadId: person.team_lead_id,
      status: person.status === "paused" ? "Paused" : "Active",
      payoutMethod: person.role === "team_lead" ? "Team payout account" : person.role === "admin" ? "Not applicable" : person.team_lead_id ? "Contractor account" : "Direct contractor",
    }));
    const mapEntry = (entry: NonNullable<typeof entriesQuery.data>[number]) => ({
      id: entry.id,
      personId: entry.contributor_id,
      receiptId: entry.receipt_id,
      receipt: entry.receipts.filename.replace(/\.pdf$/i, ""),
      date: displayDate(entry.receipts.receipt_date),
      name: entry.source_name,
      handle: entry.source_handle,
      type: entry.type,
      gross: entry.gross_cents / 100,
      payoutBps: entry.payout_bps,
      ruleVersion: entry.rule_version,
    });
    const entries = (entriesQuery.data ?? []).map(mapEntry);
    const receiptEntries = (receiptEntriesQuery.data ?? []).map(mapEntry);
    const receipts = (receiptsQuery.data ?? []).map((receipt) => ({
      id: receipt.id,
      filename: receipt.filename,
      date: displayDate(receipt.receipt_date),
      rows: receipt.contribution_entries[0]?.count ?? 0,
      total: receipt.extracted_total_cents / 100,
      status: titleStatus(receipt.status),
      issues: safeJson<string[]>(receipt.issues, []),
    }));
    const audit = (auditQuery.data ?? []).map((event) => {
      const details = safeJson<{ title?: string; detail?: string; tone?: "neutral" | "success" | "warning"; actor?: string }>(event.details, {});
      return {
        id: event.id,
        title: details.title ?? "Workspace updated",
        detail: details.detail ?? "An administrative change was recorded.",
        actor: details.actor ?? "System",
        time: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at)),
        tone: details.tone ?? "neutral",
      };
    });
    const batch = batchQuery.data;
    const payoutPolicy = safeJson<Record<string, unknown>>(settingsQuery.data?.value, {});
    const payoutDay = isPayoutWeekday(payoutPolicy.payoutDay) ? payoutPolicy.payoutDay : "Monday";
    const paymentStatuses = Object.fromEntries((batch?.payout_recipients ?? []).map((item) => [item.person_id, item.status === "paid" ? "Paid" : item.status === "failed" ? "Failed" : "Ready"]));

    return Response.json({
      people,
      entries,
      receiptEntries,
      receipts,
      audit,
      batchStatus: batch?.status === "approved" || batch?.status === "paid" ? "Approved" : "Draft",
      payoutDate: batch?.payout_date ?? "",
      payoutDay,
      paymentStatuses,
      ruleVersions: (ruleVersionsQuery.data ?? []).map((version) => ({
        version: version.version,
        status: version.status,
        effectiveFrom: version.effective_from,
        createdAt: version.created_at,
        publishedAt: version.published_at,
      })),
      rules: (rulesQuery.data ?? []).map((rule) => ({
        version: rule.version,
        type: rule.type,
        label: rule.label,
        description: rule.description,
        recipientPercentage: rule.payout_bps / 100,
        active: rule.active,
      })),
      actor: { name: actor.displayName, email: actor.email, role: actor.role },
      persistence: "Supabase PostgreSQL + Storage",
    });
  } catch (error) { return errorResponse(error); }
}
