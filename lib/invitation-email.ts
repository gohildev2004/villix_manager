import nodemailer from "nodemailer";

type InvitationRecipient = {
  email: string;
  name: string;
};

const DEFAULT_HOST = "smtp.gmail.com";
const DEFAULT_PORT = 465;

export function invitationEmailConfigured() {
  return Boolean(
    process.env.INVITATION_SMTP_USER &&
    process.env.INVITATION_SMTP_PASSWORD &&
    process.env.INVITATION_FROM_EMAIL,
  );
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
  const port = Number(process.env.INVITATION_SMTP_PORT || DEFAULT_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.INVITATION_SMTP_HOST || DEFAULT_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.INVITATION_SMTP_USER,
      pass: process.env.INVITATION_SMTP_PASSWORD,
    },
  });
  const subject = renderTemplate(subjectTemplate, recipient, portalUrl);
  const message = renderTemplate(messageTemplate, recipient, portalUrl);
  await transporter.sendMail({
    from: {
      name: process.env.INVITATION_FROM_NAME || "Villix",
      address: process.env.INVITATION_FROM_EMAIL!,
    },
    replyTo: process.env.INVITATION_FROM_EMAIL,
    to: { name: recipient.name, address: recipient.email },
    subject,
    text: message,
    html: messageHtml(message, portalUrl),
  });
}
