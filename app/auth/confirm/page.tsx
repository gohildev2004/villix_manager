"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeAdminDestination } from "@/lib/admin-navigation";

export default function ConfirmPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Securing your Villix session…");

  useEffect(() => {
    let active = true;
    async function confirm() {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const destination = safeAdminDestination(url.searchParams.get("next"));
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type") as EmailOtpType | null;
      let error: Error | null = null;

      if (code) {
        const result = await supabase.auth.exchangeCodeForSession(code);
        error = result.error;
      } else if (tokenHash && type) {
        const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        error = result.error;
      } else {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (accessToken && refreshToken) {
          const result = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          error = result.error;
        } else {
          const result = await supabase.auth.getSession();
          error = result.error ?? (result.data.session ? null : new Error("No authentication session was returned."));
        }
      }

      if (error) {
        if (active) setMessage("This sign-in link is invalid or expired.");
        window.setTimeout(() => router.replace(`/login?error=invalid_link&next=${encodeURIComponent(destination)}`), 800);
        return;
      }

      window.history.replaceState({}, document.title, `/auth/confirm?next=${encodeURIComponent(destination)}`);
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user || userError) {
        if (active) setMessage("We could not verify this administrator session.");
        window.setTimeout(() => router.replace(`/login?error=invalid_link&next=${encodeURIComponent(destination)}`), 800);
        return;
      }
      router.replace(destination);
      router.refresh();
    }
    void confirm();
    return () => { active = false; };
  }, [router]);

  return (
    <main className="login-page">
      <section className="login-card login-confirm-card">
        <div className="login-brand"><Image src="/villix-logo.svg" alt="Villix" width={47} height={36} priority unoptimized /><span>Villix Manager</span></div>
        <div className="login-confirm-spinner" aria-hidden="true" />
        <h1>Signing you in.</h1>
        <p role="status">{message}</p>
      </section>
    </main>
  );
}
