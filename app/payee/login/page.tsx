import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PayeeLoginForm from "./PayeeLoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payee sign in", robots: { index: false, follow: false } };

export default async function PayeeLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/payee");
  const { error } = await searchParams;
  return <main className="payee-login-page"><section className="payee-login-card">
    <div className="payee-brand"><Image src="/villix-logo.svg" alt="Villix" width={50} height={38} style={{ width: 50, height: 38 }} priority unoptimized /><span>Villix Payee</span></div>
    <div className="payee-login-copy"><span>Secure payout portal</span><h1>Your payouts,<br/>clearly handled.</h1><p>Use the email address invited by Villix. Your bank details will be completed through RazorpayX when hosted onboarding is activated.</p></div>
    {error === "not_authorized" && <p className="payee-login-error">This email does not have active payee access. Ask a Villix administrator to invite you.</p>}
    {error === "invalid_link" && <p className="payee-login-error">That sign-in request has expired. Request a new code below.</p>}
    <PayeeLoginForm />
    <footer>Private recipient portal · Access is logged</footer>
  </section></main>;
}
