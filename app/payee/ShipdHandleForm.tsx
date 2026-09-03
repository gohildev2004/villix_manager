"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function ShipdHandleForm({ initialHandle = "", locked = false, firstSetup = false }: { initialHandle?: string; locked?: boolean; firstSetup?: boolean }) {
  const [handle, setHandle] = useState(initialHandle);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/payee-portal/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save username.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save username."); }
    finally { setSaving(false); }
  }
  return <form className="shipd-handle-form" onSubmit={submit}>
    <label htmlFor="shipd-handle">Shipd.ai username</label>
    <p>{firstSetup ? "Enter the username you already use or plan to create on Shipd.ai. You can change it later if it is unavailable." : locked ? "Matched exactly to an approved receipt. Contact Villix if this needs correction." : "Keep this identical to your Shipd.ai username so receipt imports match automatically."}</p>
    <div><input id="shipd-handle" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@your_username" disabled={locked || saving} required autoCapitalize="none" autoCorrect="off"/><button type="submit" disabled={locked || saving}>{locked ? "Verified" : saving ? "Saving…" : firstSetup ? "Complete profile" : "Update username"}</button></div>
    {error && <span className="form-error">{error}</span>}
  </form>;
}
