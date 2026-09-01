export class ReceiptTextValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReceiptTextValidationError";
  }
}

function parseReceiptDate(text) {
  const sourceDate = text.match(/Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
  if (!sourceDate) throw new ReceiptTextValidationError("The receipt date could not be detected.");
  const parsed = new Date(sourceDate);
  if (Number.isNaN(parsed.valueOf())) throw new ReceiptTextValidationError("The receipt date could not be read.");
  return parsed.toISOString().slice(0, 10);
}

export function parseReceiptText(text) {
  const pattern = /([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*\(@([A-Za-z0-9_.-]+)\)\s+([A-Za-z][A-Za-z -]*)\s+\$([\d,]+\.\d{2})/gi;
  const rows = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    rows.push({
      id: crypto.randomUUID(),
      name: match[1].replace(/^.*?\bMember\s+Type\s+Amount\s+/i, "").trim(),
      handle: `@${match[2]}`.toLowerCase(),
      type: match[3].trim(),
      gross: Number(match[4].replace(/,/g, "")),
    });
  }
  if (!rows.length) throw new ReceiptTextValidationError("No contribution rows were detected. The receipt was not added.");
  if (rows.length > 500) throw new ReceiptTextValidationError("A receipt cannot contain more than 500 contribution rows.");

  const totalText = text.match(/TOTAL\s+\$([\d,]+\.\d{2})/i)?.[1];
  if (!totalText) throw new ReceiptTextValidationError("The receipt total could not be detected.");
  const sourceTotalCents = Math.round(Number(totalText.replace(/,/g, "")) * 100);
  const extractedTotalCents = rows.reduce((total, row) => total + Math.round(row.gross * 100), 0);
  if (sourceTotalCents !== extractedTotalCents) {
    throw new ReceiptTextValidationError(`Source total $${(sourceTotalCents / 100).toFixed(2)} does not match extracted rows $${(extractedTotalCents / 100).toFixed(2)}.`);
  }

  return { receiptDate: parseReceiptDate(text), sourceTotalCents, rows };
}
