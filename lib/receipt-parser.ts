type ParsedReceiptRow = {
  id: string;
  name: string;
  handle: string;
  type: string;
  gross: number;
};

export type ParsedReceipt = {
  receiptDate: string;
  sourceTotalCents: number;
  rows: ParsedReceiptRow[];
};

function receiptDate(text: string) {
  const sourceDate = text.match(/Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
  if (!sourceDate) throw new Error("The receipt date could not be detected.");
  const parsed = new Date(sourceDate);
  if (Number.isNaN(parsed.valueOf())) throw new Error("The receipt date could not be read.");
  return parsed.toISOString().slice(0, 10);
}

export async function parseReceiptPdf(buffer: ArrayBuffer): Promise<ParsedReceipt> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
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

  const pattern = /([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*\(@([A-Za-z0-9_.-]+)\)\s+([A-Za-z][A-Za-z -]*)\s+\$([\d,]+\.\d{2})/gi;
  const rows: ParsedReceiptRow[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    rows.push({
      id: crypto.randomUUID(),
      name: match[1].trim(),
      handle: `@${match[2]}`.toLowerCase(),
      type: match[3].trim(),
      gross: Number(match[4].replace(/,/g, "")),
    });
  }
  if (!rows.length) throw new Error("No contribution rows were detected. The receipt was not added.");
  if (rows.length > 500) throw new Error("A receipt cannot contain more than 500 contribution rows.");

  const totalText = text.match(/TOTAL\s+\$([\d,]+\.\d{2})/i)?.[1];
  if (!totalText) throw new Error("The receipt total could not be detected.");
  const sourceTotalCents = Math.round(Number(totalText.replace(/,/g, "")) * 100);
  const extractedTotalCents = rows.reduce((total, row) => total + Math.round(row.gross * 100), 0);
  if (sourceTotalCents !== extractedTotalCents) {
    throw new Error(`Source total $${(sourceTotalCents / 100).toFixed(2)} does not match extracted rows $${(extractedTotalCents / 100).toFixed(2)}.`);
  }

  return { receiptDate: receiptDate(text), sourceTotalCents, rows };
}
