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
      const contentType = response.headers.get("content-type") ?? "";
      const result = contentType.includes("application/json")
        ? await response.json() as { error?: string }
        : { error: response.ok ? undefined : "The contributor portal could not save your username. Please try again." };
      if (!response.ok) throw new Error(result.error || "Could not save username.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save username."); }
    finally { setSaving(false); }
  }

  const helperText = firstSetup
    ? "Enter the username you use on Shipd.ai. If you have not created it yet, add the username you plan to use—you can update it later."
    : locked
      ? "This username is saved to your Villix profile. Contact Villix if you need to change it."
      : "Use the same username you use on Shipd.ai. You can update it here whenever it changes.";

  return <form className="shipd-handle-form" onSubmit={submit}>
    <div className="shipd-field-copy">
      <label htmlFor="shipd-handle">Username</label>
      <p>{helperText}</p>
    </div>
    <div className="shipd-input-row"><input id="shipd-handle" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@your_username" disabled={locked || saving} required autoCapitalize="none" autoCorrect="off" spellCheck={false}/><button type="submit" disabled={locked || saving}>{locked ? "Saved" : saving ? "Saving…" : firstSetup ? "Complete profile" : "Save changes"}</button></div>
    {error && <span className="form-error">{error}</span>}
  </form>;
}
