export type PayoutCalculationEntry = {
  id: string;
  contributor_id: string | null;
  source_handle: string;
  type: string;
  gross_cents: number;
  payout_cents: number | null;
  receipt_date: string;
};
export type PayoutCalculationPerson = { id: string; display_name: string; team_lead_id: string | null };
export type PayoutCalculationAssignment = { contributor_id: string; team_lead_id: string | null; effective_from: string; effective_to: string | null };
export type CalculatedRecipient = {
  personId: string;
  routingType: "direct" | "team";
  grossCents: number;
  payableCents: number;
  contributors: Array<{ name: string; handle: string; grossCents: number; payableCents: number }>;
};
export function settlementAmount(sourceCents: number, exchangeRate: number, adjustmentBps: number): number;
export function calculatePayoutDistribution(input: {
  entries: PayoutCalculationEntry[];
  people: PayoutCalculationPerson[];
  assignments: PayoutCalculationAssignment[];
}): {
  totalGrossCents: number;
  totalPayableCents: number;
  calculationEntries: Array<{ id: string; grossCents: number; type: string; recipient: string }>;
  recipients: CalculatedRecipient[];
};
