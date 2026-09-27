const { Prisma } = require("@prisma/client");
const prisma = require("./db");
const { CURRENCY_CODE } = require("./currency");
const { getRange } = require("./utils/dateRanges");

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function listBudgets(telegramId) {
  const { start, end } = getRange("month");
  const [budgets, spending] = await Promise.all([
    prisma.budget.findMany({
      where: { telegramId },
      orderBy: { category: "asc" },
    }),
    prisma.transaction.groupBy({
      by: ["category"],
      where: {
        telegramId,
        type: "EXPENSE",
        createdAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    }),
  ]);

  const spentByCategory = new Map(
    spending.map((row) => [row.category, row._sum.amount || new Prisma.Decimal(0)])
  );

  return budgets.map((budget) => {
    const spent = spentByCategory.get(budget.category) || new Prisma.Decimal(0);
    const percent = spent.dividedBy(budget.monthlyLimit).times(100).toDecimalPlaces(1);
    return {
      id: budget.id,
      category: budget.category,
      monthlyLimit: budget.monthlyLimit.toFixed(2),
      spent: spent.toFixed(2),
      remaining: budget.monthlyLimit.minus(spent).toFixed(2),
      percent: percent.toString(),
    };
  });
}

async function checkBudgetThresholds(telegramId, category) {
  const { start, end } = getRange("month");
  const currentMonth = monthKey(start);

  return prisma.$transaction(async (transaction) => {
    const budget = await transaction.budget.findUnique({
      where: { telegramId_category: { telegramId, category } },
    });
    if (!budget) return [];

    const result = await transaction.transaction.aggregate({
      where: {
        telegramId,
        category,
        type: "EXPENSE",
        createdAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });
    const spent = result._sum.amount || new Prisma.Decimal(0);
    const updates = {};
    const alerts = [];

    if (spent.greaterThanOrEqualTo(budget.monthlyLimit)) {
      if (budget.alerted80Month !== currentMonth) {
        updates.alerted80Month = currentMonth;
      }
      if (budget.alerted100Month !== currentMonth) {
        updates.alerted100Month = currentMonth;
        alerts.push(
          `Budget exceeded: ${category} is ${CURRENCY_CODE} ${spent.toFixed(2)} of ${CURRENCY_CODE} ${budget.monthlyLimit.toFixed(2)} this month.`
        );
      }
    } else if (
      spent.greaterThanOrEqualTo(budget.monthlyLimit.times("0.8")) &&
      budget.alerted80Month !== currentMonth
    ) {
      updates.alerted80Month = currentMonth;
      alerts.push(
        `Budget alert: ${category} is at least 80% used (${CURRENCY_CODE} ${spent.toFixed(2)} of ${CURRENCY_CODE} ${budget.monthlyLimit.toFixed(2)}).`
      );
    }

    if (Object.keys(updates).length) {
      await transaction.budget.update({ where: { id: budget.id }, data: updates });
    }
    return alerts;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

module.exports = { listBudgets, checkBudgetThresholds };