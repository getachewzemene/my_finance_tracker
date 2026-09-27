const HEADERS = ["date", "type", "category", "reason", "amount", "currency"];

function escapeSpreadsheetText(value) {
  const text = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value, protectFormula = false) {
  const text = protectFormula ? escapeSpreadsheetText(value) : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function transactionsToCsv(rows) {
  const lines = [HEADERS.map((header) => csvCell(header)).join(",")];

  for (const row of rows) {
    lines.push([
      row.createdAt.toISOString(),
      row.type,
      row.category,
      escapeSpreadsheetText(row.reason),
      row.amount.toFixed(2),
      row.currencyCode.trim(),
    ].map((value) => csvCell(value)).join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

module.exports = { transactionsToCsv };