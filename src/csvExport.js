const HEADERS = ["date", "type", "category", "reason", "amount", "currency"];
const { moneyToCents, centsToMoney } = require("./utils/money");

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

function productsToCsv(products) {
  const lines = [["product", "quantity_in_stock", "unit_cost", "selling_price", "stock_cost_value", "updated_at"]
    .map((header) => csvCell(header)).join(",")];

  for (const product of products) {
    lines.push([
      csvCell(product.name, true),
      csvCell(product.quantity),
      csvCell(product.unitCost === null ? "" : product.unitCost.toFixed(2)),
      csvCell(product.unitPrice.toFixed(2)),
      csvCell(product.unitCost === null ? "" : centsToMoney(moneyToCents(product.unitCost) * BigInt(product.quantity))),
      csvCell(product.updatedAt.toISOString()),
    ].join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function salesToCsv(sales) {
  const lines = [["date", "product", "quantity", "unit_cost", "unit_price", "total_sales", "total_cost", "profit"]
    .map((header) => csvCell(header)).join(",")];

  for (const sale of sales) {
    lines.push([
      csvCell(sale.createdAt.toISOString()),
      csvCell(sale.product.name, true),
      csvCell(sale.quantity),
      csvCell(sale.unitCost.toFixed(2)),
      csvCell(sale.unitPrice.toFixed(2)),
      csvCell(sale.total.toFixed(2)),
      csvCell(sale.costTotal.toFixed(2)),
      csvCell(sale.profit.toFixed(2)),
    ].join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

module.exports = { transactionsToCsv, productsToCsv, salesToCsv };