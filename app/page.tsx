import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ManagerApp from "./ManagerApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Villix Manager",
  description: "Admin-only contribution and weekly payout operations for Villix.",
};

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: admin } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!admin) redirect("/login?error=not_authorized");
  return <ManagerApp />;
}
