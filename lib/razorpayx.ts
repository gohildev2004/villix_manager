type RazorpayPayout = { id: string; status: string; failure_reason?: string | null };

export function razorpayxConfigured() {
  return Boolean(process.env.RAZORPAYX_KEY_ID && process.env.RAZORPAYX_KEY_SECRET && process.env.RAZORPAYX_ACCOUNT_NUMBER);
}

export async function createRazorpayxPayout(input: { fundAccountId: string; amountPaise: number; idempotencyKey: string; referenceId: string; recipientName: string }) {
  const keyId = process.env.RAZORPAYX_KEY_ID;
  const keySecret = process.env.RAZORPAYX_KEY_SECRET;
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER;
  if (!keyId || !keySecret || !accountNumber) throw new Error("RazorpayX is not connected on the server.");
  const response = await fetch("https://api.razorpay.com/v1/payouts", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "content-type": "application/json",
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
  const payload = await response.json().catch(() => ({})) as RazorpayPayout & { error?: { description?: string } };
  if (!response.ok) throw new Error(payload.error?.description || `RazorpayX rejected the payout (${response.status}).`);
  if (!payload.id || !payload.status) throw new Error("RazorpayX returned an incomplete payout response.");
  return payload;
}
