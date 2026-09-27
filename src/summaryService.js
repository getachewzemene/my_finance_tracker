const prisma = require("./db");
const { Prisma } = require("@prisma/client");
const { CURRENCY_CODE } = require("./currency");
const { getRange } = require("./utils/dateRanges");

async function computeSummary(telegramId, period) {
  const { start, end } = getRange(period);
  const rows = await prisma.transaction.findMany({
    where: { telegramId, createdAt: { gte: start, lt: end } },
  });

  const income = rows
    .filter((r) => r.type === "INCOME")
    .reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
  const expense = rows
    .filter((r) => r.type === "EXPENSE")
    .reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));

  return {
    period,
    currencyCode: CURRENCY_CODE,
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    net: income.minus(expense).toFixed(2),
    count: rows.length,
  };
}

async function computeAllSummaries(telegramId) {
  const [week, month, year] = await Promise.all([
    computeSummary(telegramId, "week"),
    computeSummary(telegramId, "month"),
    computeSummary(telegramId, "year"),
  ]);
  return { week, month, year };
}

async function computeCategorySummary(telegramId, period) {
  const { start, end } = getRange(period);
  const rows = await prisma.transaction.groupBy({
    by: ["category", "type"],
    where: { telegramId, createdAt: { gte: start, lt: end } },
    _sum: { amount: true },
    orderBy: [{ category: "asc" }, { type: "asc" }],
  });

  return rows.map(({ category, type, _sum }) => ({
    category,
    type,
    amount: _sum.amount?.toFixed(2) || "0.00",
  }));
}

module.exports = { computeSummary, computeAllSummaries, computeCategorySummary };
