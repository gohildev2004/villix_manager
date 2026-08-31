"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ otpEnabled = false }: { otpEnabled?: boolean }) {
  const router = useRouter();
  const otpInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  useEffect(() => {
    if (step === "otp") otpInput.current?.focus();
  }, [step]);

  async function sendCode() {
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (otpEnabled) {
      setStep("otp");
      setCode("");
      setResendIn(60);
      setMessage("We sent a six-digit sign-in code to your email.");
    } else {
      setMessage("Check your inbox for a secure sign-in link.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "email") {
      await sendCode();
      return;
    }

    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code,
      type: "email",
    });
    setBusy(false);
    if (error) {
      setMessage("That code is incorrect or has expired. Please check it and try again.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={submit}>
      {step === "email" ? (
        <>
          <label htmlFor="email">Admin email</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" required />
          <button type="submit" disabled={busy}>{busy ? "Sending…" : otpEnabled ? "Send sign-in code" : "Continue securely"}</button>
        </>
      ) : (
        <>
          <div className="otp-heading">
            <label htmlFor="otp">Six-digit code</label>
            <button type="button" className="login-text-button" onClick={() => { setStep("email"); setMessage(""); }}>Change email</button>
          </div>
          <p className="otp-destination">Sent to <strong>{email.trim().toLowerCase()}</strong></p>
          <input
            id="otp"
            ref={otpInput}
            className="otp-input"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            aria-describedby="otp-help"
            required
          />
          <p id="otp-help" className="otp-help">The code expires shortly and can only be used once.</p>
          <button type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify and continue"}</button>
          <button type="button" className="login-secondary-button" disabled={busy || resendIn > 0} onClick={sendCode}>
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>
        </>
      )}
      {message && <p className="login-message" role="status">{message}</p>}
    </form>
  );
}
