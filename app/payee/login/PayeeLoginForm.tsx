"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { contributorPortalPath } from "@/lib/contributor-portal";

const OTP_LENGTH = 8;

export default function PayeeLoginForm() {
  const router = useRouter();
  const codeInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function sendCode() {
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${contributorPortalPath(window.location.host, "auth/confirm")}` },
    });
    setBusy(false);
    if (error) {
      setMessage("We could not send a code. Use the email address invited by Villix or contact an administrator.");
      return;
    }
    setStep("code");
    setCode("");
    setResendIn(60);
    setMessage("Your one-time code is on its way.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "email") return sendCode();
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "email" });
    setBusy(false);
    if (error) {
      setMessage("That code is incorrect or expired. Request a new code and try again.");
      return;
    }
    router.replace(contributorPortalPath(window.location.host));
    router.refresh();
  }

  return <form className="payee-login-form" onSubmit={submit}>
    {step === "email" ? <>
      <label htmlFor="payee-email">Invited email</label>
      <input id="payee-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required />
      <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send sign-in code"}</button>
    </> : <>
      <div className="payee-code-heading"><label htmlFor="payee-code">Eight-digit code</label><button type="button" onClick={() => { setStep("email"); setMessage(""); }}>Change email</button></div>
      <p>Sent to <strong>{email.trim().toLowerCase()}</strong></p>
      <input id="payee-code" ref={codeInput} className="payee-code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={OTP_LENGTH} placeholder="00000000" required />
      <button type="submit" disabled={busy || code.length !== OTP_LENGTH}>{busy ? "Verifying…" : "Open my portal"}</button>
      <button className="payee-secondary-button" type="button" disabled={busy || resendIn > 0} onClick={() => void sendCode()}>{resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}</button>
    </>}
    {message && <p className="payee-login-message" role="status">{message}</p>}
  </form>;
}
