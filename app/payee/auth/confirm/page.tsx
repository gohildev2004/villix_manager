"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { contributorPortalPath } from "@/lib/contributor-portal";

export default function PayeeConfirmPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Securing your payee session…");
  useEffect(() => {
    let active = true;
    async function confirm() {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type") as EmailOtpType | null;
      const result = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : tokenHash && type
          ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          : await supabase.auth.getSession();
      const session = "data" in result && result.data && "session" in result.data ? result.data.session : null;
      if (result.error || (!code && !tokenHash && !session)) {
        if (active) setMessage("This sign-in request is invalid or expired.");
        window.setTimeout(() => router.replace(`${contributorPortalPath(window.location.host, "login")}?error=invalid_link`), 700);
        return;
      }
      window.history.replaceState({}, document.title, contributorPortalPath(window.location.host, "auth/confirm"));
      router.replace(contributorPortalPath(window.location.host));
      router.refresh();
    }
    void confirm();
    return () => { active = false; };
  }, [router]);
  return <main className="payee-login-page"><section className="payee-login-card payee-confirm-card"><div className="payee-brand"><Image src="/villix-logo.svg" alt="Villix" width={50} height={38} style={{ width: 50, height: 38 }} priority unoptimized /><span>Villix Contributor</span></div><div className="payee-confirm-spinner"/><h1>Opening your portal.</h1><p role="status">{message}</p></section></main>;
}
