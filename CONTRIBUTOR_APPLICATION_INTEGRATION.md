# Villix Contributor Application Integration

Last reviewed: September 2, 2026

This is the implementation contract for the separate `villix.in` landing page. The landing page collects a contributor application; Villix Manager owns identity provisioning, invitation delivery, profile creation, team routing, and later receipt matching.

Both integration endpoints are server-to-server APIs. The landing page must never expose their bearer credential to browser code.

## Final user flow

1. The applicant opens the **Become a contributor** form on `villix.in`.
2. They enter first name, last name, email, and choose an active team leader.
3. The landing-page **server** submits the application to Villix Manager.
4. Villix Manager creates restricted Supabase Auth access, records the application, and sends a private Resend invitation linking to `https://contributor.villix.in`.
5. The applicant opens the portal and requests their own one-time sign-in code.
6. The portal requires a Shipd.ai username. They may enter the username they already use or the username they intend to create later.
7. Villix creates their contributor profile under the selected team leader. Their payable contribution amount therefore routes entirely to that team leader.
8. The applicant may return to `contributor.villix.in` and update the claimed Shipd.ai username.
9. When an administrator approves a receipt containing an exact match for that username, Villix marks it **Matched** and locks contributor-side edits. An administrator can still correct it in People when necessary.

Villix does not claim that a username is available on Shipd.ai. No supported Shipd availability endpoint is currently integrated. The portal clearly treats the value as a claim until an approved receipt proves the match.

## Required deployment setup

Generate one independent random secret of at least 32 characters. Add the same value to:

- production Villix Manager Render service as `CONTRIBUTOR_APPLICATION_API_KEY`;
- the production landing-page **server** as `CONTRIBUTOR_APPLICATION_API_KEY`.

For staging, generate a different secret and add it only to the staging Manager and staging landing service. Never reuse production secrets in staging.

Also configure the landing-page server:

```text
VILLIX_MANAGER_API_URL=https://admin.villix.in
CONTRIBUTOR_APPLICATION_API_KEY=<server-only secret>
```

Never prefix the secret with `NEXT_PUBLIC_`, `VITE_`, or otherwise include it in browser JavaScript. The browser must call a same-origin landing-page route or server action, and that server calls Villix Manager.

Before deploying application code, apply `supabase/migrations/20260902170000_contributor_applications.sql` to the matching Supabase project. Apply it to staging first and then production.

## Endpoint 1: list available team leaders

The landing-page server calls:

```http
GET /api/public/team-leads
Authorization: Bearer <CONTRIBUTOR_APPLICATION_API_KEY>
```

Response:

```json
{
  "teamLeads": [
    { "id": "uuid", "name": "Team Lead Name" }
  ]
}
```

Use `id` as the select value and `name` as the visible label. Fetch this on the server with `cache: "no-store"`; do not hard-code team leaders because paused or newly added leads must update automatically.

## Endpoint 2: submit an application

The landing-page server calls:

```http
POST /api/public/contributor-applications
Authorization: Bearer <CONTRIBUTOR_APPLICATION_API_KEY>
Content-Type: application/json
```

Body:

```json
{
  "firstName": "Asha",
  "lastName": "Patel",
  "email": "asha@example.com",
  "teamLeadId": "uuid-from-team-leads-endpoint",
  "source": "villix_landing_page",
  "website": ""
}
```

`website` is a hidden honeypot. Real users leave it empty. The API requires all four visible fields, verifies that the selected lead is active, rejects emails already connected to People, provisions the restricted Auth user, saves the application, and sends the invitation.

Successful response is HTTP `201`:

```json
{ "ok": true, "applicationId": "uuid" }
```

If email delivery fails, the application remains saved and the response is HTTP `503`. An administrator sees **Delivery failed** under Manager → Applications and can resend it safely.

## Next.js landing-page example

Create a server-only route or server action in the landing repository. This example is intentionally not a client component:

```ts
const managerUrl = process.env.VILLIX_MANAGER_API_URL;
const applicationKey = process.env.CONTRIBUTOR_APPLICATION_API_KEY;

export async function submitContributorApplication(input: {
  firstName: string;
  lastName: string;
  email: string;
  teamLeadId: string;
  website?: string;
}) {
  if (!managerUrl || !applicationKey) throw new Error("Contributor applications are not configured.");

  const response = await fetch(`${managerUrl}/api/public/contributor-applications`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${applicationKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...input, source: "villix_landing_page" }),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Application could not be submitted.");
  return result;
}
```

Load team leaders using the same server-only headers and `GET /api/public/team-leads`.

## Form experience

- Disable submit while the request is running so a double-click does not send two requests.
- After HTTP `201`, show: **Application received. Check your email for your private Villix Contributor invitation.**
- Do not redirect straight into Supabase Auth and do not send an OTP from the landing page. The recipient requests the OTP themselves at the contributor portal.
- On HTTP `409`, display the returned message. This usually means the email already has a profile, the application was declined, or the selected team leader is unavailable.
- On HTTP `503`, tell the applicant their application was saved and Villix will resend the invitation. Do not repeatedly auto-retry email delivery.
- Add normal origin rate limiting and bot protection on the landing-page form in addition to the honeypot.

## Administrator operations

Manager → **Applications** shows active, completed, and declined applications. Administrators can:

- see the selected team leader and claimed Shipd.ai username;
- see pending, sent, or failed invitation delivery;
- resend an incomplete applicant’s invitation;
- decline an incomplete application;
- open People after profile completion.

Completed profiles appear in People as contributors assigned to their selected lead. Because they are team members, Villix does not request their bank account; all payable money routes to the lead.

## Acceptance test

Run this in staging before production:

1. Add an active test team lead in staging Manager.
2. Confirm the lead appears in the landing form.
3. Submit a unique test email and confirm one Resend invitation is delivered.
4. Confirm the application appears in Manager → Applications as **Invitation sent**.
5. Sign in at the staging contributor portal and enter an intended Shipd.ai username such as `@future_handle`.
6. Sign out, sign in again, change it to another unused test handle, and confirm the change appears in Applications and People.
7. Confirm the person reports to the selected team lead and has no individual bank-onboarding action.
8. Import and approve a test receipt with the exact handle; confirm its state changes to **Matched**.
9. Confirm the contributor can no longer edit it, while an administrator can still correct it from People.
10. Confirm duplicate email submission and a paused team leader are rejected cleanly.

Do not use real contributor details or real payouts in staging.
