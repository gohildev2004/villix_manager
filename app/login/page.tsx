import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const otpEnabled = process.env.EMAIL_OTP_ENABLED === "true";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: admin } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).eq("active", true).maybeSingle();
    if (admin) redirect("/");
    await supabase.auth.signOut();
  }
  const { error } = await searchParams;
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><Image src="/villix-logo.svg" alt="Villix" width={54} height={42} priority unoptimized /><span>Villix Manager</span></div>
        <div className="login-copy">
          <span>Private workspace</span>
          <h1>Welcome back.</h1>
          <p>Sign in with an authorized administrator email. {otpEnabled ? "We’ll send you a six-digit verification code." : "We’ll send you a one-time secure link."}</p>
        </div>
        {error === "not_authorized" && <p className="login-error">This account is not authorized for Villix Manager.</p>}
        {error === "invalid_link" && <p className="login-error">That sign-in request is invalid or expired. Request a new {otpEnabled ? "code" : "link"} below.</p>}
        <LoginForm otpEnabled={otpEnabled} />
        <footer>Villix internal operations · Access is logged</footer>
      </section>
    </main>
  );
}
