import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePayee } from "@/lib/payee-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payee portal", robots: { index: false, follow: false } };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "—";
}

export default async function PayeePage() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) redirect("/payee/login");

  let context: Awaited<ReturnType<typeof requirePayee>>;
  try { context = await requirePayee(); }
  catch { await session.auth.signOut(); redirect("/payee/login?error=not_authorized"); }
  const { admin, payee } = context;
  const [{ data: person, error: personError }, { data: payouts, error: payoutError }] = await Promise.all([
    admin.from("people").select("id,display_name,handle,email,role,team_lead_id,status,payee_profiles(legal_name,onboarding_status,payout_provider,bank_last4,ifsc)").eq("id", payee.personId).single(),
    admin.from("payout_recipients").select("id,status,payout_amount_minor,payout_currency,paid_at,created_at,payout_batches(period_start,period_end,payout_date)").eq("person_id", payee.personId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (personError || !person) redirect("/payee/login?error=not_authorized");
  if (payoutError) throw payoutError;
  const profile = Array.isArray(person.payee_profiles) ? person.payee_profiles[0] : person.payee_profiles;
  const ready = profile?.onboarding_status === "ready" && Boolean(profile.bank_last4);
  const hostedPortalEnabled = process.env.RAZORPAYX_VENDOR_PORTAL_ENABLED === "true";
  const vendorPortalUrl = process.env.RAZORPAYX_VENDOR_PORTAL_URL || "https://x.razorpay.com/vendor-portal/";
  const paidTotal = (payouts ?? []).filter((item) => item.status === "paid").reduce((sum, item) => sum + item.payout_amount_minor, 0) / 100;

  return <main className="payee-page">
    <header className="payee-topbar"><div className="payee-brand"><Image src="/villix-logo.svg" alt="Villix" width={44} height={34} style={{ width: 44, height: 34 }} priority unoptimized /><span>Villix Payee</span></div><a href="/payee/signout">Sign out</a></header>
    <div className="payee-content"><section className="payee-welcome"><span>Recipient workspace</span><h1>Welcome, {person.display_name}.</h1><p>Manage your payout readiness and follow every Villix payment without entering the administrator workspace.</p></section>
      <section className="payee-status-card"><div><span className={`payee-status-dot ${ready ? "ready" : "pending"}`}/><div><small>Payout status</small><h2>{ready ? "Ready to receive" : hostedPortalEnabled ? "Finish secure onboarding" : "RazorpayX activation pending"}</h2><p>{ready ? `Verified Indian bank account ending ${profile?.bank_last4}.` : hostedPortalEnabled ? "RazorpayX will securely collect and validate your bank details. Villix will only receive masked account information and provider references." : "Villix is currently completing its RazorpayX business setup. No bank information is being requested or stored during test mode."}</p></div></div>{!ready && hostedPortalEnabled && <a className="payee-primary-action" href={vendorPortalUrl} target="_blank" rel="noreferrer">Continue in RazorpayX <span>↗</span></a>}</section>
      <section className="payee-metrics"><div><span>Total paid</span><strong>{inr.format(paidTotal)}</strong><small>Confirmed Villix payouts</small></div><div><span>Payments</span><strong>{(payouts ?? []).length}</strong><small>All recorded payout instructions</small></div><div><span>Payment route</span><strong>{person.role === "team_lead" ? "Team lead" : "Direct"}</strong><small>Indian bank account · INR</small></div></section>
      <section className="payee-history"><div className="payee-section-heading"><div><span>Payment history</span><h2>Weekly payouts</h2></div><small>Most recent 20</small></div>{(payouts ?? []).length ? <div className="payee-history-list">{(payouts ?? []).map((item) => { const batch = Array.isArray(item.payout_batches) ? item.payout_batches[0] : item.payout_batches; return <div key={item.id}><div><b>{batch ? `${date(batch.period_start)} – ${date(batch.period_end)}` : "Weekly Villix payout"}</b><span>Scheduled {date(batch?.payout_date ?? null)}</span></div><div><strong>{inr.format(item.payout_amount_minor / 100)}</strong><span className={`payee-payment-status ${item.status}`}>{item.status}</span></div></div>; })}</div> : <div className="payee-empty"><span>○</span><h3>No payments yet</h3><p>Your approved weekly payouts will appear here.</p></div>}</section>
      <footer className="payee-footer"><span>Signed in as {person.email}</span><span>Need help? Contact your Villix administrator.</span></footer>
    </div>
  </main>;
}
