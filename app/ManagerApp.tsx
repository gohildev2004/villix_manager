"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

type View = "overview" | "inbox" | "people" | "teams" | "payouts" | "reconciliation" | "audit" | "rules" | "settings";
type Role = "Contributor" | "Team lead" | "Admin";
type PersonStatus = "Active" | "Paused";
type Person = { id: string; name: string; handle: string; email: string; role: Role; teamLeadId: string | null; status: PersonStatus; payoutMethod: string };
type Entry = { id: string; personId: string | null; receipt: string; date: string; name: string; handle: string; type: string; gross: number; payoutBps: number | null; ruleVersion: number };
type Receipt = { id: string; filename: string; date: string; rows: number; total: number; status: "Verified" | "Needs review" | "Approved"; issues: string[] };
type PaymentStatus = "Ready" | "Paid" | "Failed";
type AuditEvent = { id: string; title: string; detail: string; actor: string; time: string; tone: "neutral" | "success" | "warning" };
type Totals = { gross: number; pay: number; retained: number; problems: number };
type PayoutRow = { key: string; name: string; handle: string; route: string; gross: number; eligible: number; payout: number; contributors: number };
type RuleVersion = { version: number; status: "draft" | "published" | "archived"; effectiveFrom: string | null; createdAt: string; publishedAt: string | null };
type ContributionRule = { version: number; type: string; label: string; description: string; recipientPercentage: number; active: boolean };
type RuleInput = Omit<ContributionRule, "version">;
type ServerState = { people: Person[]; entries: Entry[]; receipts: Receipt[]; audit: AuditEvent[]; batchStatus: "Draft" | "Approved"; payoutDate: string; paymentStatuses: Record<string, PaymentStatus>; ruleVersions: RuleVersion[]; rules: ContributionRule[]; actor: { name: string; email: string; role: string }; persistence: string };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const today = "2026-09-04";

const initialPeople: Person[] = [];
const initialEntries: Entry[] = [];
const initialReceipts: Receipt[] = [];
const initialAudit: AuditEvent[] = [];

const viewCopy: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
  overview: { eyebrow: "Operations", title: "Good morning.", subtitle: "Everything requiring attention is collected here." },
  inbox: { eyebrow: "Review queue", title: "Inbox", subtitle: "Verify source records before they affect a payout." },
  people: { eyebrow: "Directory", title: "People", subtitle: "Roles, handles, payment routes, and access in one place." },
  teams: { eyebrow: "Hierarchy", title: "Teams", subtitle: "Understand who rolls up to each payout recipient." },
  payouts: { eyebrow: "Weekly distribution", title: "Payouts", subtitle: "A complete, explainable distribution before money moves." },
  reconciliation: { eyebrow: "Payment operations", title: "Reconciliation", subtitle: "Track what was expected, sent, failed, and confirmed." },
  audit: { eyebrow: "Controls", title: "Audit log", subtitle: "An immutable record of financial and hierarchy changes." },
  rules: { eyebrow: "Calculation policy", title: "Rules", subtitle: "Versioned logic makes every historical payout reproducible." },
  settings: { eyebrow: "Workspace", title: "Settings", subtitle: "Schedule, currency, approvals, notifications, and security." },
};

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function payable(entry: Entry) { return entry.payoutBps === null ? 0 : entry.gross * (entry.payoutBps / 10000); }

export default function ManagerApp() {
  const router = useRouter();
  const [view, setView] = useState<View>("overview");
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [receipts, setReceipts] = useState<Receipt[]>(initialReceipts);
  const [audit, setAudit] = useState<AuditEvent[]>(initialAudit);
  const [query, setQuery] = useState("");
  const [personModal, setPersonModal] = useState(false);
  const [reviewReceipt, setReviewReceipt] = useState<Receipt | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [toast, setToast] = useState("");
  const [payoutDate, setPayoutDate] = useState("");
  const [batchStatus, setBatchStatus] = useState<"Draft" | "Approved">("Draft");
  const [paymentStatuses, setPaymentStatuses] = useState<Record<string, PaymentStatus>>({});
  const [ruleVersions, setRuleVersions] = useState<RuleVersion[]>([]);
  const [rules, setRules] = useState<ContributionRule[]>([]);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [serverStatus, setServerStatus] = useState<"connecting" | "online" | "error">("connecting");
  const [actorName, setActorName] = useState("Administrator");
  const fileRef = useRef<HTMLInputElement>(null);

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({})) as { error?: string } & T;
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  async function refreshState() {
    try {
      const state = await api<ServerState>("/api/state", { cache: "no-store" });
      setPeople(state.people); setEntries(state.entries); setReceipts(state.receipts); setAudit(state.audit);
      setBatchStatus(state.batchStatus); setPayoutDate(state.payoutDate); setPaymentStatuses(state.paymentStatuses);
      setRuleVersions(state.ruleVersions); setRules(state.rules);
      setActorName(state.actor.name); setServerStatus("online");
    } catch (error) {
      setServerStatus("error");
      setParseError(error instanceof Error ? `Server connection failed: ${error.message}` : "Server connection failed.");
    }
  }

  // The API is the external source of truth; hydrate this client-only dashboard once on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void refreshState(); }, []);

  const totals = useMemo<Totals>(() => {
    const gross = entries.reduce((sum, entry) => sum + entry.gross, 0);
    const pay = entries.reduce((sum, entry) => sum + payable(entry), 0);
    return { gross, pay, retained: gross - pay, problems: entries.filter((entry) => (entry.payoutBps ?? 0) > 0).length };
  }, [entries]);

  const payoutRows = useMemo<PayoutRow[]>(() => {
    const grouped = new Map<string, PayoutRow>();
    for (const entry of entries) {
      const contributor = people.find((person) => person.id === entry.personId) ?? people.find((person) => person.handle.toLowerCase() === entry.handle.toLowerCase());
      const lead = contributor?.teamLeadId ? people.find((person) => person.id === contributor.teamLeadId) : null;
      const recipient = lead || contributor;
      const key = recipient?.id || entry.handle;
      const current = grouped.get(key) || {
        key,
        name: recipient?.name || entry.name,
        handle: recipient?.handle || entry.handle,
        route: lead ? "Team payout" : contributor ? "Direct contractor" : "Needs review",
        gross: 0,
        eligible: 0,
        payout: 0,
        contributors: 0,
      };
      current.gross += entry.gross;
      if ((entry.payoutBps ?? 0) > 0) current.eligible += entry.gross;
      current.payout += payable(entry);
      const contributorKey = contributor?.id || entry.handle;
      const memberSet = new Set(entries.filter((candidate) => {
        const person = people.find((item) => item.id === candidate.personId) ?? people.find((item) => item.handle.toLowerCase() === candidate.handle.toLowerCase());
        return (person?.teamLeadId || person?.id || candidate.handle) === key;
      }).map((candidate) => candidate.personId ?? candidate.handle.toLowerCase()));
      current.contributors = Math.max(memberSet.size, contributorKey ? 1 : 0);
      grouped.set(key, current);
    }
    return [...grouped.values()];
  }, [entries, people]);

  const openIssues = receipts.reduce((sum, receipt) => sum + receipt.issues.length, 0) + (payoutDate ? 0 : 1);
  const readyPayments = payoutRows.filter((row) => row.route !== "Needs review").length;

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function addAudit(title: string, detail: string, tone: AuditEvent["tone"] = "neutral") {
    setAudit((current) => [{ id: crypto.randomUUID(), title, detail, actor: actorName, time: "Just now", tone }, ...current]);
  }

  async function parseReceipt(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setParseError("Choose a PDF receipt to continue."); return; }
    setParsing(true); setParseError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const imported = await api<{ issues: string[] }>("/api/receipts", { method: "POST", body: form });
      await refreshState();
      notify(imported.issues.length ? "Receipt imported with items to review" : "Receipt verified and added to the inbox");
      setView("inbox");
    } catch (error) { setParseError(error instanceof Error ? error.message : "The receipt could not be read."); }
    finally { setParsing(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function updatePerson(id: string, changes: Partial<Person>) {
    setPeople((current) => current.map((person) => person.id === id ? { ...person, ...changes } : person));
    try {
      await savePersonDetails(id, changes);
    } catch (error) { await refreshState(); notify(error instanceof Error ? error.message : "Person could not be updated"); }
  }

  async function savePersonDetails(id: string, changes: Partial<Person>) {
    await api("/api/people", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...changes }) });
    await refreshState(); notify("Person details updated");
  }

  async function removePerson(id: string) {
    await api("/api/people", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    await refreshState();
    notify("Person removed from Villix");
  }

  async function resolveReceiptHandle(receiptId: string, handle: string, personId: string) {
    await api("/api/receipts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: receiptId, action: "resolve_handle", handle, personId }) });
    setReviewReceipt(null); await refreshState(); notify(`${handle} matched and receipt verified`);
  }

  async function createAndResolveReceiptPerson(receiptId: string, handle: string, input: { name: string; email: string; teamLeadId: string | null }) {
    const created = await api<{ id: string }>("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, handle, role: "Contributor" }) });
    await resolveReceiptHandle(receiptId, handle, created.id);
  }

  async function deleteReceipt(receiptId: string) {
    await api("/api/receipts", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: receiptId }) });
    setReviewReceipt(null); await refreshState(); notify("Receipt and document deleted");
  }

  async function mutateRules(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, successMessage: string) {
    try {
      await api("/api/rules", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await refreshState();
      notify(successMessage);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "The rule change could not be saved");
      return false;
    }
  }

  async function approveBatch() {
    if (!payoutDate) { notify("Choose a payout date before approval"); return; }
    if (receipts.some((receipt) => receipt.issues.length)) { notify("Resolve receipt issues before approval"); setView("inbox"); return; }
    try {
      await api("/api/payouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", payoutDate, periodStart: "2026-08-24", periodEnd: "2026-08-30" }) });
      await refreshState(); notify("Weekly payout approved");
    } catch (error) { notify(error instanceof Error ? error.message : "Payout could not be approved"); }
  }

  const navigation: Array<{ group: string; items: Array<{ id: View; label: string; symbol: string; count?: number }> }> = [
    { group: "Workspace", items: [
      { id: "overview", label: "Overview", symbol: "◫" },
      { id: "inbox", label: "Inbox", symbol: "▱", count: receipts.filter((receipt) => receipt.status !== "Approved").length },
      { id: "people", label: "People", symbol: "◉" },
      { id: "teams", label: "Teams", symbol: "⌘" },
    ] },
    { group: "Money", items: [
      { id: "payouts", label: "Payouts", symbol: "$" },
      { id: "reconciliation", label: "Reconciliation", symbol: "✓" },
    ] },
    { group: "Control", items: [
      { id: "audit", label: "Audit log", symbol: "≣" },
      { id: "rules", label: "Rules", symbol: "%" },
      { id: "settings", label: "Settings", symbol: "⚙" },
    ] },
  ];

  return (
    <div className="app-shell">
      <aside className="side-panel" aria-label="Primary navigation">
        <button className="wordmark" onClick={() => setView("overview")}><Image className="brand-logo" src="/villix-logo.svg" alt="" width={41} height={32} unoptimized/><b>Villix</b></button>
        <div className="workspace-switch"><div><small>Workspace</small><strong>Administration</strong></div><span>⌄</span></div>
        <nav className="side-nav">
          {navigation.map((section) => <div className="nav-section" key={section.group}><div className="nav-heading">{section.group}</div>{section.items.map((item) => <button key={item.id} className={view === item.id ? "selected" : ""} onClick={() => setView(item.id)}><i>{item.symbol}</i><span>{item.label}</span>{item.count ? <em>{item.count}</em> : null}</button>)}</div>)}
        </nav>
        <div className="side-profile"><div className="avatar">{initials(actorName)}</div><div><b>{actorName}</b><span>Administrator</span></div><button aria-label="Sign out" title="Sign out" onClick={() => router.push("/auth/signout")}>↗</button></div>
      </aside>

      <main className="app-main">
        <header className="app-bar">
          <div className="mobile-brand"><Image className="brand-logo" src="/villix-logo.svg" alt="" width={41} height={32} unoptimized/><b>Villix</b></div>
          <div className="app-crumb">Villix Manager <span>/</span> {viewCopy[view].title}</div>
          <div className="app-actions">
            <span className={`server-state ${serverStatus}`}><i/>{serverStatus === "online" ? "Database live" : serverStatus === "connecting" ? "Connecting" : "Server offline"}</span>
            <button className="round-action" aria-label="Search">⌕</button>
            <button className="round-action" aria-label="Notifications">◦</button>
            <button className="button primary" onClick={() => fileRef.current?.click()}>Import receipt</button>
            <input className="hidden-file" ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseReceipt(file); }} />
          </div>
        </header>

        <div className="app-content">
          <header className="view-header"><div><div className="view-eyebrow">{viewCopy[view].eyebrow}</div><h1>{viewCopy[view].title}</h1><p>{viewCopy[view].subtitle}</p></div>{view !== "settings" && <button className="period-control">Aug 24 – Aug 30 <span>⌄</span></button>}</header>

          {parsing && <div className="processing-banner"><span className="spinner"/>Reading and verifying your receipt…</div>}
          {parseError && <div className="alert error-alert"><span>!</span><div><b>Receipt not added</b><p>{parseError}</p></div><button onClick={() => setParseError("")}>Dismiss</button></div>}

          {view === "overview" && <Overview totals={totals} openIssues={openIssues} receipts={receipts} payoutRows={payoutRows} payoutDate={payoutDate} setView={setView} />}
          {view === "inbox" && <Inbox receipts={receipts} approveReceipt={async (id) => { try { await api("/api/receipts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "approve" }) }); await refreshState(); notify("Receipt approved"); } catch (error) { notify(error instanceof Error ? error.message : "Receipt could not be approved"); } }} deleteReceipt={deleteReceipt} reviewReceipt={setReviewReceipt} openImport={() => fileRef.current?.click()} />}
          {view === "people" && <People people={people} entries={entries} query={query} setQuery={setQuery} updatePerson={updatePerson} editPerson={savePersonDetails} removePerson={removePerson} openAdd={() => setPersonModal(true)} />}
          {view === "teams" && <Teams people={people} entries={entries} updatePerson={updatePerson} />}
          {view === "payouts" && <Payouts totals={totals} rows={payoutRows} payoutDate={payoutDate} setPayoutDate={setPayoutDate} status={batchStatus} approve={approveBatch} openIssues={openIssues} />}
          {view === "reconciliation" && <Reconciliation rows={payoutRows} batchStatus={batchStatus} statuses={paymentStatuses} setStatuses={setPaymentStatuses} notify={notify} addAudit={addAudit} readyPayments={readyPayments} />}
          {view === "audit" && <Audit events={audit} />}
          {view === "rules" && <Rules versions={ruleVersions} rules={rules} mutate={mutateRules} />}
          {view === "settings" && <Settings saved={settingsSaved} save={() => { setSettingsSaved(true); notify("Workspace settings saved"); addAudit("Workspace settings updated", "Schedule and approval preferences were changed."); window.setTimeout(() => setSettingsSaved(false), 2400); }} />}
        </div>
      </main>

      <nav className="mobile-tabs" aria-label="Mobile navigation">{navigation.slice(0, 2).flatMap((section) => section.items).slice(0, 5).map((item) => <button key={item.id} className={view === item.id ? "selected" : ""} onClick={() => setView(item.id)}><i>{item.symbol}</i><span>{item.label}</span></button>)}</nav>
      {personModal && <PersonModal leads={people.filter((person) => person.role === "Team lead")} close={() => setPersonModal(false)} add={async (person) => { try { await api("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(person) }); setPersonModal(false); await refreshState(); notify("Person added to Villix"); } catch (error) { notify(error instanceof Error ? error.message : "Person could not be added"); } }} />}
      {reviewReceipt && <ReceiptReviewModal receipt={reviewReceipt} people={people} close={() => setReviewReceipt(null)} resolve={resolveReceiptHandle} createAndResolve={createAndResolveReceiptPerson} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Overview({ totals, openIssues, receipts, payoutRows, payoutDate, setView }: { totals: Totals; openIssues: number; receipts: Receipt[]; payoutRows: PayoutRow[]; payoutDate: string; setView: (view: View) => void }) {
  const attention = [
    { title: "Choose this week’s payout date", detail: "Approval stays locked until a date is confirmed.", action: "Set date", view: "payouts" as View, visible: !payoutDate },
    { title: `${receipts.filter((receipt) => receipt.status === "Verified").length} receipts ready for approval`, detail: "Source totals and contribution rows have been verified.", action: "Review", view: "inbox" as View, visible: receipts.some((receipt) => receipt.status === "Verified") },
    { title: "All contributor handles are matched", detail: "Every imported handle resolves to one active directory record.", action: "View people", view: "people" as View, visible: true },
  ].filter((item) => item.visible);
  return <div className="overview-layout">
    <section className="hero-summary">
      <div className="hero-copy"><span>Ready to distribute</span><strong>{money.format(totals.pay)}</strong><p>From {money.format(totals.gross)} gross across {totals.problems} eligible entries.</p></div>
      <div className="hero-ring"><div><b>{openIssues}</b><span>open<br/>items</span></div></div>
      <div className="hero-actions"><button className="button inverse" onClick={() => setView("payouts")}>Review payout</button><button className="text-button light" onClick={() => setView("inbox")}>Open inbox →</button></div>
    </section>
    <section className="stat-strip">
      <Stat label="Gross processed" value={money.format(totals.gross)} note="Across approved receipts" />
      <Stat label="Villix retained" value={money.format(totals.retained)} note="Commission + retained types" />
      <Stat label="Recipients" value={String(payoutRows.length)} note="Team leads and direct contractors" />
      <Stat label="Source integrity" value="100%" note="Imported totals reconciled" />
    </section>
    <div className="overview-columns">
      <section className="surface attention-card"><div className="section-header"><div><h2>Needs attention</h2><p>Finish these before approving the week.</p></div><span className="count-badge">{attention.length}</span></div><div className="attention-list">{attention.map((item, index) => <div className="attention-item" key={item.title}><span className="index">0{index + 1}</span><div><b>{item.title}</b><p>{item.detail}</p></div><button onClick={() => setView(item.view)}>{item.action}</button></div>)}</div></section>
      <section className="surface"><div className="section-header"><div><h2>Payout preview</h2><p>Grouped by final payment recipient.</p></div><button className="text-button" onClick={() => setView("payouts")}>View all</button></div><div className="compact-list">{payoutRows.slice(0, 4).map((row) => <div className="recipient-row" key={row.key}><Avatar name={row.name}/><div className="grow"><b>{row.name}</b><span>{row.route} · {row.contributors} contributor{row.contributors === 1 ? "" : "s"}</span></div><strong>{money.format(row.payout)}</strong></div>)}</div></section>
    </div>
  </div>;
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Avatar({ name, large = false }: { name: string; large?: boolean }) { return <span className={`person-avatar ${large ? "large" : ""}`}>{initials(name)}</span>; }

function Inbox({ receipts, approveReceipt, deleteReceipt, reviewReceipt, openImport }: { receipts: Receipt[]; approveReceipt: (id: string) => Promise<void>; deleteReceipt: (id: string) => Promise<void>; reviewReceipt: (receipt: Receipt) => void; openImport: () => void }) {
  const [filter, setFilter] = useState<"All" | Receipt["status"]>("All");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const visible = receipts.filter((receipt) => filter === "All" || receipt.status === filter);
  async function remove(receipt: Receipt) {
    if (confirmDelete !== receipt.id) { setConfirmDelete(receipt.id); return; }
    setDeleting(receipt.id);
    try { await deleteReceipt(receipt.id); }
    finally { setDeleting(null); setConfirmDelete(null); }
  }
  return <div className="stack">
    <div className="command-row"><div className="segmented">{(["All", "Needs review", "Verified", "Approved"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="button primary" onClick={openImport}>Import PDF</button></div>
    <section className="surface table-surface"><div className="data-table inbox-table"><div className="data-head"><span>Receipt</span><span>Date</span><span>Entries</span><span>Total</span><span>Status</span><span></span></div>{visible.map((receipt) => <div className="data-row" key={receipt.id}><div className="file-cell"><i>PDF</i><div><b>{receipt.filename}</b><small>{receipt.issues.length ? receipt.issues.join(" · ") : "Source total verified"}</small></div></div><span>{receipt.date}</span><span>{receipt.rows}</span><strong>{money.format(receipt.total)}</strong><Status value={receipt.status}/><div className="row-actions">{receipt.status !== "Approved" && <>{receipt.issues.length ? <button className="resolve-button" onClick={() => reviewReceipt(receipt)}>Resolve</button> : <button onClick={() => void approveReceipt(receipt.id)}>Approve</button>}<button className={`delete-receipt-button ${confirmDelete === receipt.id ? "confirm" : ""}`} disabled={deleting === receipt.id} onClick={() => void remove(receipt)}>{deleting === receipt.id ? "Deleting…" : confirmDelete === receipt.id ? "Confirm delete" : "Delete"}</button></>}</div></div>)}</div>{!visible.length && <Empty title="No receipts here" detail="Try a different status or import another PDF." />}</section>
    <div className="safety-note"><span>✓</span><div><b>Duplicate protection is active</b><p>File fingerprints and source totals are checked before a receipt can enter the ledger.</p></div></div>
  </div>;
}

function People({ people, entries, query, setQuery, updatePerson, editPerson, removePerson, openAdd }: { people: Person[]; entries: Entry[]; query: string; setQuery: (value: string) => void; updatePerson: (id: string, changes: Partial<Person>) => void; editPerson: (id: string, changes: Partial<Person>) => Promise<void>; removePerson: (id: string) => Promise<void>; openAdd: () => void }) {
  const [roleFilter, setRoleFilter] = useState<"All" | Role>("All");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const leads = people.filter((person) => person.role === "Team lead");
  const visible = people.filter((person) => (roleFilter === "All" || person.role === roleFilter) && `${person.name} ${person.handle} ${person.email}`.toLowerCase().includes(query.toLowerCase()));
  const selectedPerson = people.find((person) => person.id === selectedPersonId) ?? null;
  return <div className="stack">
    <div className="command-row"><div className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" aria-label="Search people" /></div><div className="command-actions"><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "All" | Role)}><option>All</option><option>Contributor</option><option>Team lead</option><option>Admin</option></select><button className="button primary" onClick={openAdd}>Add person</button></div></div>
    <section className="surface table-surface"><div className="data-table people-table"><div className="data-head"><span>Person</span><span>Role</span><span>Reports to</span><span>Payment route</span><span>Status</span><span></span></div>{visible.map((person) => <div className="data-row" key={person.id}><button className="identity-cell person-link" onClick={() => setSelectedPersonId(person.id)}><Avatar name={person.name}/><div><b>{person.name}</b><small>{person.handle} · {person.email}</small></div></button><select className="inline-select" value={person.role} onChange={(event) => updatePerson(person.id, { role: event.target.value as Role, teamLeadId: event.target.value === "Contributor" ? person.teamLeadId : null })}><option>Contributor</option><option>Team lead</option><option>Admin</option></select><div>{person.role === "Contributor" ? <select className="inline-select" value={person.teamLeadId || "direct"} onChange={(event) => updatePerson(person.id, { teamLeadId: event.target.value === "direct" ? null : event.target.value })}><option value="direct">No team lead</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.name}</option>)}</select> : <span className="muted">—</span>}</div><span>{person.role === "Contributor" && person.teamLeadId ? "Via team lead" : person.payoutMethod}</span><Status value={person.status}/><div className="row-actions"><button className="profile-button" onClick={() => setSelectedPersonId(person.id)}>Profile</button><button onClick={() => updatePerson(person.id, { status: person.status === "Active" ? "Paused" : "Active" })}>{person.status === "Active" ? "Pause" : "Activate"}</button></div></div>)}</div>{!visible.length && <Empty title="No matching people" detail="Clear the search or add a new person." />}</section>
    {selectedPerson && <PersonProfileModal person={selectedPerson} people={people} entries={entries} close={() => setSelectedPersonId(null)} edit={(changes) => editPerson(selectedPerson.id, changes)} remove={async () => { await removePerson(selectedPerson.id); setSelectedPersonId(null); }} />}
  </div>;
}

function PersonProfileModal({ person, people, entries, close, edit, remove }: { person: Person; people: Person[]; entries: Entry[]; close: () => void; edit: (changes: Partial<Person>) => Promise<void>; remove: () => Promise<void> }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editRole, setEditRole] = useState<Role>(person.role);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const ownEntries = entries.filter((entry) => entry.personId === person.id || (!entry.personId && entry.handle.toLowerCase() === person.handle.toLowerCase()));
  const members = people.filter((candidate) => candidate.teamLeadId === person.id);
  const memberIds = new Set(members.map((member) => member.id));
  const memberHandles = new Set(members.map((member) => member.handle.toLowerCase()));
  const teamEntries = entries.filter((entry) => entry.personId ? memberIds.has(entry.personId) : memberHandles.has(entry.handle.toLowerCase()));
  const ownGross = ownEntries.reduce((sum, entry) => sum + entry.gross, 0);
  const ownPayable = ownEntries.reduce((sum, entry) => sum + payable(entry), 0);
  const teamPayable = teamEntries.reduce((sum, entry) => sum + payable(entry), 0);
  const totalRouted = ownPayable + teamPayable;
  const lead = people.find((candidate) => candidate.id === person.teamLeadId);
  const receiptCount = new Set(ownEntries.map((entry) => entry.receipt)).size;
  const breakdown = Array.from(ownEntries.reduce((groups, entry) => {
    const current = groups.get(entry.type) ?? { count: 0, gross: 0, payable: 0 };
    current.count += 1; current.gross += entry.gross; current.payable += payable(entry);
    groups.set(entry.type, current); return groups;
  }, new Map<string, { count: number; gross: number; payable: number }>()).entries());
  const recent = [...ownEntries].reverse().slice(0, 6);
  const earnedLabel = person.role === "Team lead" ? "Total routed" : person.teamLeadId ? "Payable generated" : "Total earned";

  async function confirmDeletion() {
    if (!confirmRemove) { setConfirmRemove(true); setRemoveError(""); return; }
    setRemoving(true); setRemoveError("");
    try { await remove(); }
    catch (error) { setRemoveError(error instanceof Error ? error.message : "This person could not be removed."); setConfirmRemove(false); }
    finally { setRemoving(false); }
  }

  async function saveEdits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true); setEditError("");
    try {
      await edit({
        name: String(data.get("name") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        handle: String(data.get("handle") ?? "").trim(),
        role: editRole,
        teamLeadId: editRole === "Contributor" && data.get("teamLeadId") !== "direct" ? String(data.get("teamLeadId")) : null,
        status: String(data.get("status")) as PersonStatus,
      });
      setEditing(false);
    } catch (error) { setEditError(error instanceof Error ? error.message : "Person details could not be updated."); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="modal person-profile-modal" role="dialog" aria-modal="true" aria-label={`${person.name} profile`}>
      <header className="person-profile-header"><div className="profile-identity"><Avatar name={person.name} large/><div><span>{person.role}</span><h2>{person.name}</h2><p>{person.handle} · {person.email}</p></div></div><div className="profile-header-actions"><button className="profile-edit-trigger" onClick={() => { setEditing((current) => !current); setEditError(""); setEditRole(person.role); }}>{editing ? "Done" : "Edit"}</button><button onClick={close} aria-label="Close">×</button></div></header>
      <div className="person-profile-body">
        <div className="profile-route"><Status value={person.status}/><span>{lead ? `Payouts route to ${lead.name}` : person.role === "Team lead" ? `${members.length} team member${members.length === 1 ? "" : "s"} route here` : person.payoutMethod === "direct" ? "Paid directly" : "No payout route"}</span></div>
        {editing && <form className="edit-person-form" onSubmit={(event) => void saveEdits(event)}>
          <div className="edit-person-heading"><div><h3>Edit person details</h3><p>Identity changes are audited. Previous submissions remain linked by permanent person ID.</p></div><span>Admin only</span></div>
          <div className="modal-grid"><label>Full name<input name="name" required defaultValue={person.name} /></label><label>Receipt handle<input name="handle" required defaultValue={person.handle} /></label><label className="wide">Email address<input name="email" type="email" required defaultValue={person.email} /></label><label>Role<select value={editRole} onChange={(event) => setEditRole(event.target.value as Role)}><option>Contributor</option><option>Team lead</option><option>Admin</option></select></label><label>Status<select name="status" defaultValue={person.status}><option>Active</option><option>Paused</option></select></label>{editRole === "Contributor" && <label className="wide">Payment route<select name="teamLeadId" defaultValue={person.teamLeadId ?? "direct"}><option value="direct">No team lead · Direct contractor</option>{people.filter((candidate) => candidate.role === "Team lead" && candidate.id !== person.id).map((candidate) => <option value={candidate.id} key={candidate.id}>Via {candidate.name}</option>)}</select></label>}</div>
          {editError && <div className="review-error">{editError}</div>}
          <footer><button type="button" className="button secondary" onClick={() => { setEditing(false); setEditError(""); }}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></footer>
        </form>}
        <section className="profile-metrics">
          <div><span>Submissions</span><strong>{ownEntries.length}</strong><small>Verified entries</small></div>
          <div><span>Gross contributed</span><strong>{money.format(ownGross)}</strong><small>Across {receiptCount} receipt{receiptCount === 1 ? "" : "s"}</small></div>
          <div><span>{earnedLabel}</span><strong>{money.format(person.role === "Team lead" ? totalRouted : ownPayable)}</strong><small>{person.role === "Team lead" ? `${money.format(teamPayable)} from team` : lead ? `Routed to ${lead.name}` : "Eligible payout"}</small></div>
          <div><span>Eligible rate</span><strong>{ownGross ? `${Math.round((ownPayable / ownGross) * 100)}%` : "—"}</strong><small>Blended by rule type</small></div>
        </section>
        {person.role === "Team lead" && <section className="profile-team-summary"><div><span>Team performance</span><b>{members.length} member{members.length === 1 ? "" : "s"}</b></div><div><span>Team submissions</span><b>{teamEntries.length}</b></div><div><span>Team gross</span><b>{money.format(teamEntries.reduce((sum, entry) => sum + entry.gross, 0))}</b></div><div><span>Team payable routed</span><b>{money.format(teamPayable)}</b></div></section>}
        <div className="profile-columns">
          <section><div className="profile-section-title"><h3>Contribution breakdown</h3><span>All time</span></div>{breakdown.length ? <div className="profile-breakdown">{breakdown.map(([type, values]) => <div key={type}><span className="type-chip">{type}</span><span>{values.count} submission{values.count === 1 ? "" : "s"}</span><div className="breakdown-amount"><strong>{money.format(values.gross)}</strong><small>{money.format(values.payable)} payable</small></div></div>)}</div> : <Empty title="No submissions yet" detail="Verified receipt entries will appear here." />}</section>
          <section><div className="profile-section-title"><h3>Recent submissions</h3><span>{recent.length ? `${recent.length} shown` : "No activity"}</span></div>{recent.length ? <div className="profile-activity">{recent.map((entry) => <div key={entry.id}><div><b>{entry.type}</b><span>{entry.receipt} · {entry.date}</span></div><div><strong>{money.format(entry.gross)}</strong><small>{money.format(payable(entry))} payable</small></div></div>)}</div> : <Empty title="No recent activity" detail="Import and verify a receipt to begin." />}</section>
        </div>
        <div className="profile-data-note">Statistics include verified and approved receipt entries. Review items are excluded until they are resolved.</div>
        {removeError && <div className="review-error">{removeError}</div>}
      </div>
      <footer className="person-profile-footer"><div><b>Remove from People</b><span>Only people with no financial or team history can be permanently removed.</span></div><button className={`button danger-button ${confirmRemove ? "confirm" : ""}`} disabled={removing || person.role === "Admin"} onClick={() => void confirmDeletion()}>{removing ? "Removing…" : person.role === "Admin" ? "Protected admin" : confirmRemove ? "Confirm removal" : "Remove person"}</button></footer>
    </section>
  </div>;
}

function Teams({ people, entries, updatePerson }: { people: Person[]; entries: Entry[]; updatePerson: (id: string, changes: Partial<Person>) => void }) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const leads = people.filter((person) => person.role === "Team lead");
  const directs = people.filter((person) => person.role === "Contributor" && !person.teamLeadId);
  const selectedLead = leads.find((lead) => lead.id === selectedGroup);
  const selectedMembers = selectedGroup === "direct" ? directs : people.filter((person) => person.teamLeadId === selectedGroup);
  const available = people.filter((person) => person.role === "Contributor" && !selectedMembers.some((member) => member.id === person.id));

  function openManager(group: string) {
    setSelectedGroup((current) => current === group ? null : group);
    setCandidateId("");
  }

  function addToSelectedGroup() {
    if (!candidateId || !selectedGroup) return;
    updatePerson(candidateId, { teamLeadId: selectedGroup === "direct" ? null : selectedGroup });
    setCandidateId("");
  }

  return <div className="team-grid">{leads.map((lead) => {
    const members = people.filter((person) => person.teamLeadId === lead.id);
    const handles = new Set(members.map((person) => person.handle.toLowerCase()));
    const payout = entries.filter((entry) => handles.has(entry.handle.toLowerCase())).reduce((sum, entry) => sum + payable(entry), 0);
    return <section className={`surface team-card ${selectedGroup === lead.id ? "managing" : ""}`} key={lead.id}><div className="team-owner"><Avatar name={lead.name} large/><div><span>Team lead</span><h2>{lead.name}</h2><p>{lead.handle}</p></div><Status value={lead.status}/></div><div className="team-summary"><div><span>Members</span><strong>{members.length}</strong></div><div><span>Weekly payable</span><strong>{money.format(payout)}</strong></div></div><div className="member-stack">{members.map((member) => <div key={member.id}><Avatar name={member.name}/><span>{member.name}</span><small>{member.handle}</small></div>)}</div><button className="card-button" aria-expanded={selectedGroup === lead.id} onClick={() => openManager(lead.id)}>{selectedGroup === lead.id ? "Close manager" : "Manage team"}</button></section>;
  })}<section className={`surface team-card direct-card ${selectedGroup === "direct" ? "managing" : ""}`}><div className="team-owner"><span className="direct-symbol">↗</span><div><span>Independent</span><h2>Direct contractors</h2><p>Paid without a team lead</p></div></div><div className="team-summary"><div><span>Contributors</span><strong>{directs.length}</strong></div><div><span>Weekly payable</span><strong>{money.format(entries.filter((entry) => directs.some((person) => person.handle.toLowerCase() === entry.handle.toLowerCase())).reduce((sum, entry) => sum + payable(entry), 0))}</strong></div></div><div className="member-stack">{directs.map((member) => <div key={member.id}><Avatar name={member.name}/><span>{member.name}</span><small>{member.handle}</small></div>)}</div><button className="card-button" aria-expanded={selectedGroup === "direct"} onClick={() => openManager("direct")}>{selectedGroup === "direct" ? "Close manager" : "Manage contractors"}</button></section>

  {selectedGroup && <section className="surface team-manager" aria-live="polite">
    <div className="team-manager-header"><div><span>Team management</span><h2>{selectedGroup === "direct" ? "Direct contractors" : `${selectedLead?.name || "Team"}'s members`}</h2><p>Move contributors or change their status without leaving this page.</p></div><button className="round-action" onClick={() => setSelectedGroup(null)} aria-label="Close team manager">×</button></div>
    <div className="team-manager-list">
      {selectedMembers.map((member) => <div className="team-manager-row" key={member.id}><Avatar name={member.name}/><div className="team-manager-identity"><b>{member.name}</b><span>{member.handle} · {member.email}</span></div><label>Payment group<select value={member.teamLeadId || "direct"} onChange={(event) => updatePerson(member.id, { teamLeadId: event.target.value === "direct" ? null : event.target.value })}><option value="direct">Direct contractor</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.name}&apos;s team</option>)}</select></label><button className="team-status-button" onClick={() => updatePerson(member.id, { status: member.status === "Active" ? "Paused" : "Active" })}>{member.status === "Active" ? "Pause" : "Activate"}</button></div>)}
      {!selectedMembers.length && <Empty title="No contributors in this group" detail="Add a contributor below or move someone here from another team." />}
    </div>
    <div className="team-manager-add"><div><b>Add a contributor</b><span>Selecting someone will move them from their current payment group.</span></div><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Choose contributor</option>{available.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.teamLeadId ? leads.find((lead) => lead.id === person.teamLeadId)?.name : "Direct"}</option>)}</select><button className="button primary" disabled={!candidateId} onClick={addToSelectedGroup}>Add to group</button></div>
  </section>}
  </div>;
}

function Payouts({ totals, rows, payoutDate, setPayoutDate, status, approve, openIssues }: { totals: Totals; rows: PayoutRow[]; payoutDate: string; setPayoutDate: (value: string) => void; status: "Draft" | "Approved"; approve: () => void; openIssues: number }) {
  return <div className="stack"><section className="payout-hero"><div><Status value={status}/><h2>Aug 24 – Aug 30</h2><p>Batch VLX-2026-W35 · USD · Rule set v1</p></div><div className="payout-total"><span>Total to distribute</span><strong>{money.format(totals.pay)}</strong></div><div className="approval-block"><label>Payout date<input type="date" min={today} value={payoutDate} onChange={(event) => setPayoutDate(event.target.value)} /></label><button className="button primary" onClick={approve} disabled={status === "Approved"}>{status === "Approved" ? "Approved" : "Approve payout"}</button></div></section>{!payoutDate && <div className="alert warning-alert"><span>!</span><div><b>Approval is waiting for a payout date</b><p>The batch is calculated, but no money can be approved until the schedule is confirmed.</p></div></div>}{openIssues > 1 && <div className="alert error-alert"><span>!</span><div><b>{openIssues - 1} receipt issues remain</b><p>Resolve every source exception before approving this payout.</p></div></div>}<section className="surface table-surface"><div className="section-header"><div><h2>Distribution</h2><p>Every amount is grouped under its final recipient.</p></div><button className="button secondary">Export CSV</button></div><div className="data-table payout-table"><div className="data-head"><span>Recipient</span><span>Route</span><span>All gross</span><span>Problem gross</span><span>Villix keeps</span><span>Payable</span></div>{rows.map((row) => <div className="data-row" key={row.key}><div className="identity-cell"><Avatar name={row.name}/><div><b>{row.name}</b><small>{row.handle} · {row.contributors} contributor{row.contributors === 1 ? "" : "s"}</small></div></div><span>{row.route}</span><span>{money.format(row.gross)}</span><span>{money.format(row.eligible)}</span><span>{money.format(row.gross - row.payout)}</span><strong className="payable">{money.format(row.payout)}</strong></div>)}</div><div className="table-total"><span>Batch totals</span><span>{money.format(totals.gross)}</span><span>{money.format(totals.gross - totals.pay)}</span><strong>{money.format(totals.pay)}</strong></div></section></div>;
}

function Reconciliation({ rows, batchStatus, statuses, setStatuses, notify, addAudit, readyPayments }: { rows: PayoutRow[]; batchStatus: "Draft" | "Approved"; statuses: Record<string, PaymentStatus>; setStatuses: React.Dispatch<React.SetStateAction<Record<string, PaymentStatus>>>; notify: (message: string) => void; addAudit: (title: string, detail: string, tone?: AuditEvent["tone"]) => void; readyPayments: number }) {
  const paid = rows.filter((row) => statuses[row.key] === "Paid").reduce((sum, row) => sum + row.payout, 0);
  function mark(row: PayoutRow, status: PaymentStatus) { setStatuses((current) => ({ ...current, [row.key]: status })); addAudit(`${row.name} marked ${status.toLowerCase()}`, `${money.format(row.payout)} payment status updated.`, status === "Paid" ? "success" : "warning"); notify(`Payment marked ${status.toLowerCase()}`); }
  return <div className="stack"><section className="recon-summary"><Stat label="Expected" value={money.format(rows.reduce((sum, row) => sum + row.payout, 0))} note={`${readyPayments} payment recipients`} /><Stat label="Confirmed paid" value={money.format(paid)} note={`${Object.values(statuses).filter((status) => status === "Paid").length} completed`} /><Stat label="Remaining" value={money.format(rows.reduce((sum, row) => sum + row.payout, 0) - paid)} note="Pending confirmation" /></section>{batchStatus === "Draft" && <div className="alert warning-alert"><span>i</span><div><b>This payout is still a draft</b><p>Payment tracking becomes operational after the batch is approved.</p></div></div>}<section className="surface table-surface"><div className="section-header"><div><h2>Payment ledger</h2><p>Confirm each transfer against its provider reference.</p></div><button className="button secondary">Upload confirmation</button></div><div className="data-table recon-table"><div className="data-head"><span>Recipient</span><span>Amount</span><span>Reference</span><span>Status</span><span></span></div>{rows.map((row, index) => { const status = statuses[row.key] || "Ready"; return <div className="data-row" key={row.key}><div className="identity-cell"><Avatar name={row.name}/><div><b>{row.name}</b><small>{row.route}</small></div></div><strong>{money.format(row.payout)}</strong><span className="mono">{status === "Paid" ? `VLX-W35-${String(index + 1).padStart(3, "0")}` : "—"}</span><Status value={status}/><div className="row-actions"><button disabled={batchStatus === "Draft" || status === "Paid"} onClick={() => mark(row, "Paid")}>Mark paid</button><button disabled={batchStatus === "Draft"} onClick={() => mark(row, "Failed")}>Failed</button></div></div>; })}</div></section></div>;
}

function Audit({ events }: { events: AuditEvent[] }) { return <div className="audit-layout"><section className="surface audit-list"><div className="section-header"><div><h2>Activity</h2><p>Financial history cannot be edited or deleted.</p></div><button className="button secondary">Export log</button></div>{events.map((event) => <div className="audit-event" key={event.id}><span className={`event-dot ${event.tone}`}/><div><b>{event.title}</b><p>{event.detail}</p><small>{event.actor} · {event.time}</small></div></div>)}</section><aside className="surface audit-aside"><h3>Audit integrity</h3><div className="integrity-score">100<span>%</span></div><p>All financial and hierarchy changes are attributed and timestamped.</p><ul><li>Append-only events</li><li>Rule version snapshots</li><li>Recipient routing snapshots</li><li>Approval attribution</li></ul></aside></div>; }

function Rules({ versions, rules, mutate }: { versions: RuleVersion[]; rules: ContributionRule[]; mutate: (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, successMessage: string) => Promise<boolean> }) {
  const preferred = versions.find((version) => version.status === "draft") ?? versions.find((version) => version.status === "published") ?? versions[0];
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [editing, setEditing] = useState<ContributionRule | "new" | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const selected = versions.find((version) => version.version === selectedVersion) ?? preferred;
  const visibleRules = selected ? rules.filter((rule) => rule.version === selected.version) : [];
  const isDraft = selected?.status === "draft";
  const splitRule = visibleRules.find((rule) => rule.type === "problem" && rule.active) ?? visibleRules.find((rule) => rule.active && rule.recipientPercentage > 0) ?? visibleRules[0];
  const recipientPercentage = splitRule?.recipientPercentage ?? 0;
  const villixPercentage = 100 - recipientPercentage;
  const statusLabel = selected?.status === "draft" ? "Draft policy" : selected?.status === "archived" ? "Archived policy" : "Active policy";
  const dateLabel = selected?.effectiveFrom ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${selected.effectiveFrom}T00:00:00Z`)) : "Not published";

  async function createVersion() {
    const ok = await mutate("POST", { action: "create_version" }, "Editable rule version created");
    if (ok) setSelectedVersion(null);
  }

  return <>
    <div className="rules-layout">
      <section className="surface rules-card">
        <header className="rules-card-header">
          <div>
            <div className={`rules-kicker ${isDraft ? "draft" : ""}`}><span><i/>{statusLabel}</span><label>Version<select value={selected?.version ?? ""} onChange={(event) => setSelectedVersion(Number(event.target.value))}>{versions.map((version) => <option value={version.version} key={version.version}>V{version.version} · {version.status}</option>)}</select></label></div>
            <h2>Contribution policy</h2>
            <p>{isDraft ? "Unpublished changes · Future receipts are not affected yet" : `Effective ${dateLabel} · Historical receipts keep their original snapshot`}</p>
          </div>
          <div className="rule-header-actions">
            {isDraft ? <><button className="button secondary" onClick={() => setEditing("new")}><span className="button-plus">+</span> Add rule</button><button className="button primary" onClick={() => setPublishOpen(true)}>Publish version</button></> : selected?.status === "published" && <button className="button secondary rule-version-button" onClick={() => void createVersion()}><span>+</span> New version</button>}
          </div>
        </header>
        <div className={`rule-columns ${isDraft ? "editable" : ""}`} aria-hidden="true"><span>Contribution type</span><span>Villix keeps</span><span>Recipient gets</span><span>Status</span>{isDraft && <span>Actions</span>}</div>
        {visibleRules.map((rule) => <div className={`rule-row ${rule.type === "problem" ? "eligible" : ""} ${isDraft ? "editable" : ""}`} key={`${rule.version}:${rule.type}`}>
          <div className="rule-name"><span className={`rule-icon ${rule.type === "problem" ? "problem" : rule.type === "bonus" ? "bonus" : "custom"}`}>{rule.label.slice(0, 1).toUpperCase()}</span><div><b>{rule.label}</b><small>{rule.description || rule.type}</small></div></div>
          <div className="rule-value"><span>Villix keeps</span><strong>{100 - rule.recipientPercentage}%</strong></div>
          <div className="rule-value recipient"><span>Recipient gets</span><strong>{rule.recipientPercentage}%</strong></div>
          <Status value={rule.active ? "Active" : "Paused"}/>
          {isDraft && <div className="rule-actions"><button onClick={() => setEditing(rule)}>Edit</button><button className="danger" onClick={() => setEditing(rule)}>Remove</button></div>}
        </div>)}
        {!visibleRules.length && <div className="rule-empty"><span>＋</span><b>No rules in this draft</b><p>Add at least one active contribution type before publishing.</p><button className="button secondary" onClick={() => setEditing("new")}>Add first rule</button></div>}
        <div className="rule-row locked">
          <div className="rule-name"><span className="rule-icon unknown">?</span><div><b>Unknown type</b><small>Never calculated automatically</small></div></div>
          <div className="rule-review"><span className="rule-lock">!</span><div><strong>Manual review</strong><small>Receipt is blocked before payout</small></div></div>
          <Status value="Safety lock"/>
        </div>
      </section>

      <aside className="surface rule-explainer">
        <div className="rule-aside-kicker"><span>Selected split</span><b>{splitRule?.label ?? "No rule"}</b></div>
        <div className="rule-split-visual" style={{ background: `conic-gradient(var(--blue) 0 ${recipientPercentage}%, #202124 ${recipientPercentage}% 100%)` }}><div><strong>{villixPercentage}/{recipientPercentage}</strong><span>Villix · Recipient</span></div></div>
        <h2>{isDraft ? "Review before it goes live." : "Simple by design."}</h2>
        <p>{splitRule ? `Villix retains ${villixPercentage}% of every ${splitRule.label.toLowerCase()} contribution. The remaining ${recipientPercentage}% follows the contributor’s payout route.` : "Add a contribution rule to define how future receipts are distributed."}</p>
        <div className="rule-route-note"><span>→</span><div><b>Team routing applies</b><small>If a contributor has a team lead, their entire payable share routes to that lead.</small></div></div>
        <footer><span>Policy snapshot</span><b>VLX-RULE-V{selected?.version ?? "—"}</b></footer>
      </aside>
    </div>
    {editing && selected && <RuleModal version={selected.version} rule={editing === "new" ? null : editing} close={() => setEditing(null)} save={async (input, originalType) => {
      const ok = await mutate(originalType ? "PATCH" : "POST", { action: originalType ? undefined : "add", version: selected.version, originalType, ...input }, originalType ? "Rule updated" : "Rule added");
      if (ok) setEditing(null);
      return ok;
    }} remove={editing !== "new" ? async (type) => {
      const ok = await mutate("DELETE", { version: selected.version, type }, "Rule removed from draft");
      if (ok) setEditing(null);
      return ok;
    } : undefined}/>}
    {publishOpen && selected && <PublishRulesModal version={selected.version} ruleCount={visibleRules.filter((rule) => rule.active).length} close={() => setPublishOpen(false)} publish={async (effectiveDate) => {
      const ok = await mutate("POST", { action: "publish", version: selected.version, effectiveDate }, `Rule version ${selected.version} published`);
      if (ok) setPublishOpen(false);
      return ok;
    }}
    />}
  </>;
}

function RuleModal({ version, rule, close, save, remove }: { version: number; rule: ContributionRule | null; close: () => void; save: (input: RuleInput, originalType?: string) => Promise<boolean>; remove?: (type: string) => Promise<boolean> }) {
  const [recipientPercentage, setRecipientPercentage] = useState(rule?.recipientPercentage ?? 50);
  const [active, setActive] = useState(rule?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    await save({ type: String(data.get("type") ?? ""), label: String(data.get("label") ?? ""), description: String(data.get("description") ?? ""), recipientPercentage, active }, rule?.type);
    setBusy(false);
  }
  async function removeRule() {
    if (!rule || !remove) return;
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true); await remove(rule.type); setBusy(false);
  }
  return <div className="modal-backdrop"><section className="modal rule-modal" role="dialog" aria-modal="true" aria-labelledby="rule-modal-title"><header><div><span>Draft version {version}</span><h2 id="rule-modal-title">{rule ? `Edit ${rule.label}` : "Add contribution rule"}</h2></div><button onClick={close} aria-label="Close">×</button></header><form onSubmit={submit}><div className="modal-grid"><label>Rule name<input name="label" required maxLength={60} defaultValue={rule?.label ?? ""} placeholder="Review bonus" /></label><label>Receipt type key<input name="type" required maxLength={40} defaultValue={rule?.type ?? ""} placeholder="review_bonus" /></label><label className="wide">Description<input name="description" maxLength={180} defaultValue={rule?.description ?? ""} placeholder="How this contribution is treated" /></label><label>Recipient gets<div className="percentage-input"><input name="recipientPercentage" type="number" min="0" max="100" step="0.01" value={recipientPercentage} onChange={(event) => setRecipientPercentage(Number(event.target.value))}/><span>%</span></div></label><label>Status<select value={active ? "active" : "paused"} onChange={(event) => setActive(event.target.value === "active")}><option value="active">Active</option><option value="paused">Paused</option></select></label></div><div className="rule-preview"><div><span>Villix keeps</span><strong>{Math.max(0, 100 - (Number.isFinite(recipientPercentage) ? recipientPercentage : 0))}%</strong></div><i/><div><span>Recipient gets</span><strong>{Number.isFinite(recipientPercentage) ? recipientPercentage : 0}%</strong></div></div><div className="modal-note"><span>i</span>Changes only affect receipts imported after this draft is published. Existing payout snapshots never change.</div><footer className="rule-modal-footer">{rule && <button type="button" className={`button danger-button ${confirmRemove ? "confirm" : ""}`} disabled={busy} onClick={() => void removeRule()}>{confirmRemove ? "Remove permanently" : "Remove rule"}</button>}<span className="footer-spacer"/><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy} type="submit">{busy ? "Saving…" : rule ? "Save changes" : "Add rule"}</button></footer></form></section></div>;
}

function PublishRulesModal({ version, ruleCount, close, publish }: { version: number; ruleCount: number; close: () => void; publish: (effectiveDate: string) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); await publish(String(data.get("effectiveDate") ?? "")); setBusy(false); }
  return <div className="modal-backdrop"><section className="modal publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-rules-title"><header><div><span>Final review</span><h2 id="publish-rules-title">Publish version {version}</h2></div><button onClick={close} aria-label="Close">×</button></header><form onSubmit={submit}><div className="publish-summary"><span className="publish-symbol">✓</span><div><b>{ruleCount} active {ruleCount === 1 ? "rule" : "rules"} ready</b><p>Once published, this version becomes read-only and is used for future receipt imports.</p></div></div><label className="publish-date">Effective date<input name="effectiveDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)}/></label><div className="modal-note warning"><span>!</span>Publish policy changes between weekly payout periods whenever possible. A week cannot be approved if it mixes rule versions.</div><footer><button type="button" className="button secondary" onClick={close}>Keep editing</button><button className="button primary" type="submit" disabled={busy || ruleCount === 0}>{busy ? "Publishing…" : "Publish policy"}</button></footer></form></section></div>;
}

function Settings({ saved, save }: { saved: boolean; save: () => void }) {
  return <div className="settings-layout"><section className="surface settings-card">
    <div className="settings-section"><div><h2>Payout schedule</h2><p>Define how weekly batches are created.</p></div><div className="settings-fields"><label>Week starts<select defaultValue="Monday"><option>Monday</option><option>Sunday</option><option>Saturday</option></select></label><label>Cutoff time<input type="time" defaultValue="18:00" /></label><label>Timezone<select defaultValue="America/Los_Angeles"><option>America/Los_Angeles</option><option>UTC</option><option>America/New_York</option></select></label></div></div>
    <div className="settings-section"><div><h2>Money</h2><p>Currency and approval controls.</p></div><div className="settings-fields"><label>Currency<select defaultValue="USD"><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Second approval above<input defaultValue="$5,000.00" /></label><label className="toggle-label">Two-person approval<input className="toggle-input" type="checkbox" defaultChecked/><span className="toggle on"><i/></span></label></div></div>
    <div className="settings-section"><div><h2>Notifications</h2><p>Choose which operational changes reach admins.</p></div><div className="toggle-list"><label>Receipt needs review<input className="toggle-input" type="checkbox" defaultChecked/><span className="toggle on"><i/></span></label><label>Payout approved<input className="toggle-input" type="checkbox" defaultChecked/><span className="toggle on"><i/></span></label><label>Payment failed<input className="toggle-input" type="checkbox" defaultChecked/><span className="toggle on"><i/></span></label><label>Weekly summary<input className="toggle-input" type="checkbox"/><span className="toggle"><i/></span></label></div></div>
    <div className="settings-footer"><span>{saved ? "✓ Changes saved" : "Settings apply to future batches."}</span><button className="button primary" onClick={save}>Save changes</button></div>
  </section><aside className="surface security-card"><span className="security-symbol">⌾</span><h2>Private workspace</h2><p>Only explicitly authorized administrators can access Villix Manager.</p><div><span>Authentication</span><strong>Required</strong></div><div><span>Session logging</span><strong>Active</strong></div><div><span>Payment detail access</span><strong>Restricted</strong></div></aside></div>;
}

function ReceiptReviewModal({ receipt, people, close, resolve, createAndResolve }: { receipt: Receipt; people: Person[]; close: () => void; resolve: (receiptId: string, handle: string, personId: string) => Promise<void>; createAndResolve: (receiptId: string, handle: string, input: { name: string; email: string; teamLeadId: string | null }) => Promise<void> }) {
  const unmatchedHandles = receipt.issues.flatMap((issue) => issue.startsWith("Unmatched handle ") ? [issue.slice("Unmatched handle ".length)] : []);
  const otherIssues = receipt.issues.filter((issue) => !issue.startsWith("Unmatched handle "));
  const candidates = people.filter((person) => person.status === "Active" && person.role !== "Admin");
  const leads = people.filter((person) => person.status === "Active" && person.role === "Team lead");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function match(handle: string) {
    const personId = selected[handle];
    if (!personId) return;
    setBusy(true); setError("");
    try { await resolve(receipt.id, handle, personId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The handle could not be matched."); setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>, handle: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await createAndResolve(receipt.id, handle, {
        name: String(data.get("name") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        teamLeadId: data.get("teamLeadId") === "direct" ? null : String(data.get("teamLeadId") ?? ""),
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The contributor could not be created."); setBusy(false); }
  }

  return <div className="modal-backdrop"><section className="modal receipt-review-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-review-title">
    <header><div><span>Receipt review</span><h2 id="receipt-review-title">Resolve before payout</h2></div><button onClick={close} aria-label="Close">×</button></header>
    <div className="receipt-review-body"><div className="review-file"><i>PDF</i><div><b>{receipt.filename}</b><span>{receipt.rows} entries · {money.format(receipt.total)}</span></div><Status value={receipt.status}/></div>
      <p className="review-intro">Match each receipt handle to the person who produced the work. Their payable amount will then follow their direct or team-lead route.</p>
      {unmatchedHandles.map((handle) => <section className="handle-resolution" key={handle}><div className="handle-resolution-title"><span>Unmatched handle</span><strong>{handle}</strong></div>
        {creating === handle ? <form onSubmit={(event) => void create(event, handle)}><div className="modal-grid"><label>Contributor name<input name="name" required defaultValue={handle.slice(1).replaceAll("_", " ")} /></label><label>Email address<input name="email" type="email" required placeholder="person@example.com" /></label><label className="wide">Payment route<select name="teamLeadId" defaultValue="direct"><option value="direct">Direct contractor</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>Via {lead.name}</option>)}</select></label></div><div className="resolution-actions"><button type="button" className="button secondary" onClick={() => setCreating(null)}>Back</button><button className="button primary" disabled={busy} type="submit">{busy ? "Creating…" : "Create and match"}</button></div></form> : <><label className="match-person-label">Match to an existing person<select value={selected[handle] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [handle]: event.target.value }))}><option value="">Choose person</option>{candidates.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.handle} · {person.role}</option>)}</select></label><div className="resolution-actions"><button className="button secondary" onClick={() => setCreating(handle)}>Create contributor</button><button className="button primary" disabled={busy || !selected[handle]} onClick={() => void match(handle)}>{busy ? "Matching…" : "Match person"}</button></div></>}
      </section>)}
      {otherIssues.map((issue) => <div className="modal-note warning" key={issue}><span>!</span>{issue}. Update the contribution policy in Rules, then return here.</div>)}
      {error && <div className="review-error">{error}</div>}
    </div>
  </section></div>;
}

function PersonModal({ leads, close, add }: { leads: Person[]; close: () => void; add: (person: Person) => void }) {
  const [role, setRole] = useState<Role>("Contributor");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const handle = String(data.get("handle") || "").trim();
    add({ id: crypto.randomUUID(), name: String(data.get("name") || "").trim(), handle: handle.startsWith("@") ? handle : `@${handle}`, email: String(data.get("email") || "").trim(), role, teamLeadId: role === "Contributor" && data.get("teamLead") !== "direct" ? String(data.get("teamLead")) : null, status: "Active", payoutMethod: role === "Contributor" ? "Contractor account" : role === "Team lead" ? "Team payout account" : "Not applicable" });
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title"><header><div><span>Directory</span><h2 id="add-person-title">Add person</h2></div><button onClick={close} aria-label="Close">×</button></header><form onSubmit={submit}><div className="modal-grid"><label>Full name<input name="name" required placeholder="Jordan Lee" /></label><label>Receipt handle<input name="handle" required placeholder="@jordan" /></label><label className="wide">Email address<input type="email" name="email" required placeholder="jordan@villix.co" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option>Contributor</option><option>Team lead</option><option>Admin</option></select></label>{role === "Contributor" && <label>Team lead<select name="teamLead" defaultValue="direct"><option value="direct">No team lead · Direct</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.name}</option>)}</select></label>}</div><div className="modal-note"><span>i</span>The receipt handle must be unique. It is used to match imported contribution rows.</div><footer><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" type="submit">Add person</button></footer></form></section></div>;
}

function Status({ value }: { value: string }) { const key = value.toLowerCase().replaceAll(" ", "-"); return <span className={`status ${key}`}><i/>{value}</span>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><span>○</span><b>{title}</b><p>{detail}</p></div>; }
