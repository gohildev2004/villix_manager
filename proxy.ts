import { NextResponse, type NextRequest } from "next/server";
import { isContributorPortalHost } from "@/lib/contributor-portal";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (isContributorPortalHost(request.headers.get("x-forwarded-host") || request.headers.get("host"))) {
    const aliases = new Map([
      ["/", "/payee"],
      ["/login", "/payee/login"],
      ["/auth/confirm", "/payee/auth/confirm"],
      ["/signout", "/payee/signout"],
    ]);
    const target = aliases.get(request.nextUrl.pathname);
    if (target) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = target;
      return updateSession(request, rewriteUrl);
    }
    const isPayeePage = request.nextUrl.pathname.startsWith("/payee");
    const isPayeeApi = request.nextUrl.pathname.startsWith("/api/payee-portal/");
    if (!isPayeePage && !isPayeeApi) {
      return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    }
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
