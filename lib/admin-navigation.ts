export const adminViews = ["overview", "applications", "inbox", "people", "teams", "payouts", "reconciliation", "audit", "rules", "health", "settings"] as const;

export type AdminView = (typeof adminViews)[number];

export function parseAdminView(value: string | string[] | null | undefined): AdminView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return adminViews.includes(candidate as AdminView) ? candidate as AdminView : "overview";
}

export function adminViewHref(view: AdminView) {
  return view === "overview" ? "/" : `/?view=${view}`;
}

export function safeAdminDestination(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://admin.villix.in");
    if (url.pathname !== "/") return "/";
    return adminViewHref(parseAdminView(url.searchParams.get("view")));
  } catch {
    return "/";
  }
}
