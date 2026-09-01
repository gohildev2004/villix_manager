const CONTRIBUTOR_HOSTS = new Set(["contributor.villix.in", "contributor.localhost"]);

export function isContributorPortalHost(host: string | null | undefined) {
  const hostname = (host ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
  return CONTRIBUTOR_HOSTS.has(hostname);
}

export function contributorPortalPath(host: string | null | undefined, path = "") {
  const suffix = path ? `/${path.replace(/^\/+/, "")}` : "";
  return isContributorPortalHost(host) ? suffix || "/" : `/payee${suffix}`;
}

export function contributorPortalConfirmUrl(origin: string) {
  const normalized = origin.replace(/\/$/, "");
  try {
    return `${normalized}${contributorPortalPath(new URL(normalized).host, "auth/confirm")}`;
  } catch {
    return `${normalized}/payee/auth/confirm`;
  }
}

