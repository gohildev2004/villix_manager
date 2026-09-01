export type ParsedReceiptTextRow = {
  id: string;
  name: string;
  handle: string;
  type: string;
  gross: number;
};

export type ParsedReceiptText = {
  receiptDate: string;
  sourceTotalCents: number;
  rows: ParsedReceiptTextRow[];
};

export class ReceiptTextValidationError extends Error {}
export function parseReceiptText(text: string): ParsedReceiptText;
