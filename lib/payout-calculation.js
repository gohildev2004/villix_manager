export function settlementAmount(sourceCents, exchangeRate, adjustmentBps) {
  return Math.round(sourceCents * exchangeRate * (10000 - adjustmentBps) / 10000);
}

function historicalLead(assignments, contributorId, receiptDate, fallbackLeadId) {
  const assignment = assignments
    .filter((item) => item.contributor_id === contributorId && item.effective_from <= receiptDate && (!item.effective_to || item.effective_to >= receiptDate))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
  return assignment ? assignment.team_lead_id : fallbackLeadId;
}

export function calculatePayoutDistribution({ entries, people, assignments }) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const recipients = new Map();
  const calculationEntries = [];
  let totalGrossCents = 0;
  let totalPayableCents = 0;

  for (const entry of entries) {
    if (!entry.contributor_id) throw new Error(`Contribution ${entry.source_handle} is not matched to a contributor.`);
    if (entry.payout_cents === null) throw new Error(`Contribution ${entry.source_handle} has no payable rule.`);
    const contributor = peopleById.get(entry.contributor_id);
    if (!contributor) throw new Error(`Contributor ${entry.source_handle} is no longer available.`);

    const teamLeadId = historicalLead(assignments, contributor.id, entry.receipt_date, contributor.team_lead_id);
    const recipientId = teamLeadId ?? contributor.id;
    totalGrossCents += entry.gross_cents;
    totalPayableCents += entry.payout_cents;
    calculationEntries.push({ id: entry.id, grossCents: entry.gross_cents, type: entry.type, recipient: recipientId });

    const recipient = recipients.get(recipientId) ?? {
      personId: recipientId,
      routingType: teamLeadId ? "team" : "direct",
      grossCents: 0,
      payableCents: 0,
      contributors: new Map(),
    };
    recipient.grossCents += entry.gross_cents;
    recipient.payableCents += entry.payout_cents;
    const contribution = recipient.contributors.get(contributor.id) ?? {
      name: contributor.display_name,
      handle: entry.source_handle,
      grossCents: 0,
      payableCents: 0,
    };
    contribution.grossCents += entry.gross_cents;
    contribution.payableCents += entry.payout_cents;
    recipient.contributors.set(contributor.id, contribution);
    recipients.set(recipientId, recipient);
  }

  return {
    totalGrossCents,
    totalPayableCents,
    calculationEntries,
    recipients: [...recipients.values()]
      .filter((recipient) => recipient.payableCents > 0)
      .map((recipient) => ({ ...recipient, contributors: [...recipient.contributors.values()] })),
  };
}
