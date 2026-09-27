const prisma = require("./db");
const { getRange } = require("./utils/dateRanges");

async function computeSummary(telegramId, period) {
  const { start, end } = getRange(period);
  const rows = await prisma.transaction.findMany({
    where: { telegramId, createdAt: { gte: start, lt: end } },
  });

  const income = rows
    .filter((r) => r.type === "INCOME")
    .reduce((sum, r) => sum + r.amount, 0);
  const expense = rows
    .filter((r) => r.type === "EXPENSE")
    .reduce((sum, r) => sum + r.amount, 0);

  return { period, income, expense, net: income - expense, count: rows.length };
}

async function computeAllSummaries(telegramId) {
  const [week, month, year] = await Promise.all([
    computeSummary(telegramId, "week"),
    computeSummary(telegramId, "month"),
    computeSummary(telegramId, "year"),
  ]);
  return { week, month, year };
}

module.exports = { computeSummary, computeAllSummaries };
