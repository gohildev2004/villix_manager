import { createHmac, timingSafeEqual } from "node:crypto";

export type RazorpayPayout = {
  id: string;
  status: string;
  failure_reason?: string | null;
  status_details?: Record<string, unknown> | null;
};

type RazorpayContact = { id: string; active?: boolean };
type RazorpayFundAccount = { id: string; active?: boolean; bank_account?: { account_number?: string; ifsc?: string } };

function credentials() {
  const keyId = process.env.RAZORPAYX_KEY_ID;
  const keySecret = process.env.RAZORPAYX_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("RazorpayX is not connected on the server.");
  return { keyId, keySecret };
}

async function razorpayRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { keyId, keySecret } = credentials();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "content-type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: { description?: string } };
  if (!response.ok) throw new Error(payload.error?.description || `RazorpayX rejected the request (${response.status}).`);
  return payload;
}

export function razorpayxConfigured() {
  return Boolean(process.env.RAZORPAYX_KEY_ID && process.env.RAZORPAYX_KEY_SECRET && process.env.RAZORPAYX_ACCOUNT_NUMBER);
}

export function razorpayxWebhookConfigured() {
  return Boolean(process.env.RAZORPAYX_WEBHOOK_SECRET && process.env.SUPABASE_SECRET_KEY);
}

export async function createRazorpayxContact(input: { name: string; email: string; referenceId: string }) {
  const contact = await razorpayRequest<RazorpayContact>("/contacts", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      type: "vendor",
      reference_id: input.referenceId.slice(0, 40),
      notes: { source: "Villix Manager" },
    }),
  });
  if (!contact.id) throw new Error("RazorpayX returned an incomplete Contact response.");
  return contact;
}

export async function createRazorpayxFundAccount(input: { contactId: string; legalName: string; accountNumber: string; ifsc: string }) {
  const fundAccount = await razorpayRequest<RazorpayFundAccount>("/fund_accounts", {
    method: "POST",
    body: JSON.stringify({
      contact_id: input.contactId,
      account_type: "bank_account",
      bank_account: {
        name: input.legalName,
        ifsc: input.ifsc,
        account_number: input.accountNumber,
      },
    }),
  });
  if (!fundAccount.id) throw new Error("RazorpayX returned an incomplete Fund Account response.");
  return fundAccount;
}

export async function createRazorpayxPayout(input: { fundAccountId: string; amountPaise: number; idempotencyKey: string; referenceId: string; recipientName: string }) {
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER;
  if (!accountNumber) throw new Error("RazorpayX is not connected on the server.");
  const payload = await razorpayRequest<RazorpayPayout>("/payouts", {
    method: "POST",
    headers: {
      "X-Payout-Idempotency": input.idempotencyKey,
    },
    body: JSON.stringify({
      account_number: accountNumber,
      fund_account_id: input.fundAccountId,
      amount: input.amountPaise,
      currency: "INR",
      mode: process.env.RAZORPAYX_PAYOUT_MODE || "NEFT",
      purpose: "payout",
      queue_if_low_balance: false,
      reference_id: input.referenceId.slice(0, 40),
      narration: "Villix contractor payout",
      notes: { recipient: input.recipientName, source: "Villix Manager" },
    }),
  });
  if (!payload.id || !payload.status) throw new Error("RazorpayX returned an incomplete payout response.");
  return payload;
}

export async function fetchRazorpayxPayout(id: string) {
  if (!/^pout_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid RazorpayX payout reference.");
  const payout = await razorpayRequest<RazorpayPayout>(`/payouts/${id}`);
  if (!payout.id || !payout.status) throw new Error("RazorpayX returned an incomplete payout response.");
  return payout;
}

export function mapRazorpayxPayoutStatus(status: string): "processing" | "paid" | "failed" {
  if (status === "processed") return "paid";
  if (["failed", "reversed", "cancelled", "rejected"].includes(status)) return "failed";
  return "processing";
}

function signatureMatches(rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function verifyRazorpayxWebhook(rawBody: string, signature: string) {
  const current = process.env.RAZORPAYX_WEBHOOK_SECRET;
  const previous = process.env.RAZORPAYX_WEBHOOK_PREVIOUS_SECRET;
  if (!current) throw new Error("RazorpayX webhook verification is not configured.");
  return signatureMatches(rawBody, signature, current) || Boolean(previous && signatureMatches(rawBody, signature, previous));
}
