import { parseReceiptText, ReceiptTextValidationError, type ParsedReceiptTextRow } from "@/lib/receipt-text";

type ParsedReceiptRow = ParsedReceiptTextRow;

export type ParsedReceipt = {
  receiptDate: string;
  sourceTotalCents: number;
  rows: ParsedReceiptRow[];
};

export class ReceiptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptValidationError";
  }
}

export async function parseReceiptPdf(buffer: ArrayBuffer): Promise<ParsedReceipt> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // PDF.js transfers its input to a worker and may detach the underlying
  // ArrayBuffer. Give it an owned copy so the original remains available for
  // hashing and uploading after extraction completes.
  const pdfData = new Uint8Array(buffer).slice();
  const loadingTask = getDocument({ data: pdfData });
  const document = await loadingTask.promise;
  let text = "";
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      text += `${content.items.map((item) => "str" in item ? item.str : "").join(" ")}\n`;
    }
  } finally {
    await loadingTask.destroy();
  }

  try {
    return parseReceiptText(text);
  } catch (error) {
    if (error instanceof ReceiptTextValidationError) throw new ReceiptValidationError(error.message);
    throw error;
  }
}
