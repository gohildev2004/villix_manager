import nodemailer from "nodemailer";

type InvitationRecipient = {
  email: string;
  name: string;
};

const DEFAULT_HOST = "smtp.gmail.com";
const DEFAULT_PORT = 465;
const RESEND_API_URL = "https://api.resend.com/emails";

export type InvitationEmailProvider = "resend" | "smtp" | "none";

export function invitationEmailProvider(): InvitationEmailProvider {
  if (process.env.RESEND_API_KEY && process.env.INVITATION_FROM_EMAIL) return "resend";
  if (
    process.env.INVITATION_SMTP_USER &&
    process.env.INVITATION_SMTP_PASSWORD &&
    process.env.INVITATION_FROM_EMAIL
  ) return "smtp";
  return "none";
}

export function invitationEmailConfigured() {
  return invitationEmailProvider() !== "none";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function renderTemplate(template: string, recipient: InvitationRecipient, portalUrl: string) {
  return template
    .replaceAll("{{name}}", recipient.name)
    .replaceAll("{{portal_url}}", portalUrl);
}

function messageHtml(message: string, portalUrl: string) {
  const paragraphs = message
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 18px;color:#303034;font-size:16px;line-height:1.55">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
  const safePortalUrl = escapeHtml(portalUrl);
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e5e7;border-radius:20px;padding:36px"><div style="font-size:20px;font-weight:700;letter-spacing:-.02em;margin-bottom:28px">Villix Contributor</div>${paragraphs}<a href="${safePortalUrl}" style="display:inline-block;margin-top:4px;padding:13px 20px;border-radius:12px;background:#111;color:#fff;text-decoration:none;font-size:15px;font-weight:700">Open contributor portal</a><p style="margin:28px 0 0;color:#8a8a8f;font-size:12px;line-height:1.5">This invitation was sent by Villix. Sign in only at contributor.villix.in.</p></div></body></html>`;
}

export async function sendInvitationEmail({ recipient, subjectTemplate, messageTemplate, portalUrl }: {
  recipient: InvitationRecipient;
  subjectTemplate: string;
  messageTemplate: string;
  portalUrl: string;
}) {
  if (!invitationEmailConfigured()) throw new Error("Invitation email is not configured.");
  const fromEmail = process.env.INVITATION_FROM_EMAIL!;
  const fromName = process.env.INVITATION_FROM_NAME || "Villix";
  const subject = renderTemplate(subjectTemplate, recipient, portalUrl);
  const message = renderTemplate(messageTemplate, recipient, portalUrl);

  if (invitationEmailProvider() === "resend") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          reply_to: fromEmail,
          to: [`${recipient.name} <${recipient.email}>`],
          subject,
          text: message,
          html: messageHtml(message, portalUrl),
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({})) as { message?: string; name?: string };
      if (!response.ok) throw new Error(result.message || result.name || `Email provider rejected the request (${response.status}).`);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("Email provider connection timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const port = Number(process.env.INVITATION_SMTP_PORT || DEFAULT_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.INVITATION_SMTP_HOST || DEFAULT_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.INVITATION_SMTP_USER,
      pass: process.env.INVITATION_SMTP_PASSWORD,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transporter.sendMail({
    from: {
      name: fromName,
      address: fromEmail,
    },
    replyTo: fromEmail,
    to: { name: recipient.name, address: recipient.email },
    subject,
    text: message,
    html: messageHtml(message, portalUrl),
  });
}
