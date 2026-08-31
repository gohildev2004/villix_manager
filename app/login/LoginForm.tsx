"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setMessage(error ? error.message : "Check your inbox for a secure sign-in link.");
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="email">Admin email</label>
      <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" required />
      <button type="submit" disabled={busy}>{busy ? "Sending…" : "Continue securely"}</button>
      {message && <p className="login-message" role="status">{message}</p>}
    </form>
  );
}
