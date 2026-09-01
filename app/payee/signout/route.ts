import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicOrigin } from "@/lib/public-origin";
import { contributorPortalPath, isContributorPortalHost } from "@/lib/contributor-portal";

export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const origin = isContributorPortalHost(host) ? process.env.PAYEE_PORTAL_ORIGIN?.replace(/\/$/, "") || publicOrigin(request) : publicOrigin(request);
  return NextResponse.redirect(new URL(contributorPortalPath(host, "login"), origin));
}
