require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const prisma = require("./db");
const { CURRENCY_CODE } = require("./currency");
const { CATEGORIES } = require("./categories");
const { listBudgets, checkBudgetThresholds } = require("./budgetService");
const { validateInitData, AuthError } = require("./auth");
const { computeSummary, computeAllSummaries, computeCategorySummary } = require("./summaryService");
const { getRange } = require("./utils/dateRanges");
const { moneyToCents, centsToMoney } = require("./utils/money");
const { transactionsToCsv, productsToCsv, salesToCsv } = require("./csvExport");
const { bot, configureBot } = require("./bot");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
const startBot = configureBot(app);

app.get("/api/config", (_req, res) => {
  res.json({ currencyCode: CURRENCY_CODE, categories: CATEGORIES });
});

// --- auth ----------------------------------------------------------------
//
// Every /api/* request must carry a valid, freshly-signed Telegram initData
// string in the X-Telegram-Init-Data header. We verify its HMAC signature
// against BOT_TOKEN (see src/auth.js) and take the telegram user id *from
// the verified payload* — never from anything the client can set directly
// (a query param, a body field, etc). That closes off the previous "just
// pass any userId you like" hole: without the bot token, nobody can forge
// a signature that validates.

const INIT_DATA_MAX_AGE_SECONDS = Number(process.env.INIT_DATA_MAX_AGE_SECONDS) || 24 * 60 * 60;

function notifyBudgetThresholds(telegramId, category) {
  checkBudgetThresholds(telegramId, category)
    .then((messages) => Promise.all(messages.map((message) => bot.telegram.sendMessage(telegramId, message))))
    .catch((err) => console.error("Budget threshold alert failed:", err));
}

function telegramAuth(req, res, next) {
  try {
    const initData = req.header("X-Telegram-Init-Data");
    const { user } = validateInitData(initData, process.env.BOT_TOKEN, {
      maxAgeSeconds: INIT_DATA_MAX_AGE_SECONDS,
    });
    req.telegramId = String(user.id);
    next();
  } catch (err) {
    const message = err instanceof AuthError ? err.message : "Unauthorized";
    res.status(401).json({ error: message });
  }
}

app.use("/api", telegramAuth);

// --- API ----------------------------------------------------------------
// Every handler below uses req.telegramId (set by telegramAuth above) —
// never a client-supplied id — so a user can only ever read, add to, or
// delete their own data.

// Add a transaction: { type: "INCOME"|"EXPENSE", amount, reason }
app.post("/api/transactions", async (req, res) => {
  const { type, amount, reason } = req.body;
  const category = req.body.category || "Other";

  if (!["INCOME", "EXPENSE"].includes(type)) {
    return res.status(400).json({ error: "type must be INCOME or EXPENSE" });
  }
  if (!CATEGORIES[type].includes(category)) {
    return res.status(400).json({ error: `category is not valid for ${type.toLowerCase()}` });
  }
  const amountText = String(amount ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) {
    return res.status(400).json({ error: "amount must be positive, with up to 12 whole digits and 2 decimal places" });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "reason is required" });
  }

  const tx = await prisma.transaction.create({
    data: {
      telegramId: req.telegramId,
      type,
      amount: amountText,
      category,
      reason: String(reason).trim().slice(0, 200),
    },
  });

  res.json(tx);
  if (type === "EXPENSE") notifyBudgetThresholds(req.telegramId, category);
});

// List recent transactions for the authenticated user
app.get("/api/transactions", async (req, res) => {
  const period = req.query.period || "all";
  const type = req.query.type;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  if (!["all", "today", "week", "month", "year"].includes(period)) {
    return res.status(400).json({ error: "period must be all, today, week, month, or year" });
  }
  if (type && !["INCOME", "EXPENSE"].includes(type)) {
    return res.status(400).json({ error: "type must be INCOME or EXPENSE" });
  }

  const where = { telegramId: req.telegramId };
  if (period !== "all") {
    const { start, end } = getRange(period);
    where.createdAt = { gte: start, lt: end };
  }
  if (type) {
    where.type = type;
  }

  const rows = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(rows);
});

function parseDateBoundary(dateText, offsetText, addDay = false) {
  if (typeof dateText !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  if (typeof offsetText !== "string" || !/^-?\d{1,3}$/.test(offsetText)) return null;
  const [year, month, day] = dateText.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) return null;

  const offset = Number(offsetText);
  if (!Number.isInteger(offset) || offset < -840 || offset > 840) return null;
  if (addDay) normalized.setUTCDate(normalized.getUTCDate() + 1);
  return new Date(normalized.getTime() + offset * 60 * 1000);
}

app.get("/api/transactions/export.csv", async (req, res) => {
  if (typeof req.query.from !== "string" || typeof req.query.to !== "string" || req.query.from > req.query.to) {
    return res.status(400).json({ error: "Provide a valid start date on or before the end date." });
  }
  const from = parseDateBoundary(req.query.from, req.query.fromOffset);
  const until = parseDateBoundary(req.query.to, req.query.toOffset, true);
  if (!from || !until || from >= until) {
    return res.status(400).json({ error: "Provide a valid start date and end date, with start on or before end." });
  }

  const rows = await prisma.transaction.findMany({
    where: {
      telegramId: req.telegramId,
      createdAt: { gte: from, lt: until },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      createdAt: true,
      type: true,
      category: true,
      reason: true,
      amount: true,
      currencyCode: true,
    },
  });

  const filename = `transactions-${req.query.from}-to-${req.query.to}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(transactionsToCsv(rows));
});

// Delete a single transaction — only if it belongs to the authenticated user
app.delete("/api/transactions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx || tx.telegramId !== req.telegramId) {
    // Same response whether it doesn't exist or belongs to someone else —
    // don't reveal which, that itself would leak information.
    return res.status(404).json({ error: "not found" });
  }

  const linkedSale = await prisma.sale.findFirst({
    where: { transactionId: id, telegramId: req.telegramId },
    select: { id: true },
  });
  if (linkedSale) return res.status(409).json({ error: "Sale income cannot be deleted separately from its stock record" });

  await prisma.transaction.delete({ where: { id } });
  res.json({ ok: true });
});

// Summary for one period: /api/summary?period=week|month|year
app.get("/api/summary", async (req, res) => {
  const period = req.query.period || "month";
  if (!["week", "month", "year"].includes(period)) {
    return res.status(400).json({ error: "period must be week, month, or year" });
  }

  res.json(await computeSummary(req.telegramId, period));
});

// Convenience: all three periods in one call, used by the mini app dashboard
app.get("/api/summary/all", async (req, res) => {
  res.json(await computeAllSummaries(req.telegramId));
});

app.get("/api/summary/categories", async (req, res) => {
  const period = req.query.period || "month";
  if (!["today", "week", "month", "year"].includes(period)) {
    return res.status(400).json({ error: "period must be today, week, month, or year" });
  }

  res.json(await computeCategorySummary(req.telegramId, period));
});

app.get("/api/budgets", async (req, res) => {
  res.json(await listBudgets(req.telegramId));
});

app.post("/api/budgets", async (req, res) => {
  const { category, monthlyLimit } = req.body;
  if (!CATEGORIES.EXPENSE.includes(category)) {
    return res.status(400).json({ error: "category must be a valid expense category" });
  }

  const amountText = String(monthlyLimit ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) {
    return res.status(400).json({ error: "monthlyLimit must be positive, with up to 12 whole digits and 2 decimal places" });
  }

  const budget = await prisma.budget.upsert({
    where: { telegramId_category: { telegramId: req.telegramId, category } },
    create: { telegramId: req.telegramId, category, monthlyLimit: amountText },
    update: { monthlyLimit: amountText },
  });
  res.json(budget);
  notifyBudgetThresholds(req.telegramId, category);
});

app.delete("/api/budgets/:category", async (req, res) => {
  const { category } = req.params;
  if (!CATEGORIES.EXPENSE.includes(category)) {
    return res.status(400).json({ error: "category must be a valid expense category" });
  }

  await prisma.budget.deleteMany({ where: { telegramId: req.telegramId, category } });
  res.json({ ok: true });
});

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const MAX_MONEY_CENTS = 99999999999999n;

app.get("/api/products", async (req, res) => {
  const products = await prisma.product.findMany({
    where: { telegramId: req.telegramId },
    orderBy: { name: "asc" },
  });
  res.json(products);
});

app.post("/api/products", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const quantityText = String(req.body.quantity ?? "").trim();
  const quantity = Number(quantityText);
  const unitCost = String(req.body.unitCost ?? "").trim();
  const unitPrice = String(req.body.unitPrice ?? "").trim();

  if (!name || name.length > 100) {
    return res.status(400).json({ error: "name is required and must be 100 characters or fewer" });
  }
  if (!quantityText || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000000000) {
    return res.status(400).json({ error: "quantity must be a non-negative whole number" });
  }
  if (!MONEY_PATTERN.test(unitCost) || Number(unitCost) <= 0) {
    return res.status(400).json({ error: "unitCost must be positive, with up to 12 whole digits and 2 decimal places" });
  }
  if (!MONEY_PATTERN.test(unitPrice) || Number(unitPrice) <= 0) {
    return res.status(400).json({ error: "unitPrice must be positive, with up to 12 whole digits and 2 decimal places" });
  }

  try {
    const product = await prisma.product.create({
      data: { telegramId: req.telegramId, name, quantity, unitCost, unitPrice },
    });
    res.json(product);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A product with that name already exists" });
    throw err;
  }
});

app.patch("/api/products/:id/pricing", async (req, res) => {
  const id = Number(req.params.id);
  const unitCost = String(req.body.unitCost ?? "").trim();
  const unitPrice = String(req.body.unitPrice ?? "").trim();
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid product id" });
  if (!MONEY_PATTERN.test(unitCost) || Number(unitCost) <= 0) {
    return res.status(400).json({ error: "unitCost must be positive, with up to 12 whole digits and 2 decimal places" });
  }
  if (!MONEY_PATTERN.test(unitPrice) || Number(unitPrice) <= 0) {
    return res.status(400).json({ error: "unitPrice must be positive, with up to 12 whole digits and 2 decimal places" });
  }

  const result = await prisma.product.updateMany({
    where: { id, telegramId: req.telegramId },
    data: { unitCost, unitPrice },
  });
  if (!result.count) return res.status(404).json({ error: "Product not found" });
  res.json(await prisma.product.findUnique({ where: { id } }));
});

app.post("/api/products/:id/restock", async (req, res) => {
  const id = Number(req.params.id);
  const quantity = Number(req.body.quantity);
  const unitCost = String(req.body.unitCost ?? "").trim();
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid product id" });
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000000) {
    return res.status(400).json({ error: "quantity must be a positive whole number" });
  }
  if (!MONEY_PATTERN.test(unitCost) || Number(unitCost) <= 0) {
    return res.status(400).json({ error: "unitCost must be positive, with up to 12 whole digits and 2 decimal places" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id, telegramId: req.telegramId } });
    if (!product) return { error: "Product not found", status: 404 };
    if (product.unitCost === null) return { error: "Set the current stock cost before restocking", status: 409 };
    const newQuantity = product.quantity + quantity;
    if (newQuantity > 2147483647) return { error: "Stock quantity limit exceeded", status: 409 };

    const totalCostCents = moneyToCents(product.unitCost) * BigInt(product.quantity)
      + moneyToCents(unitCost) * BigInt(quantity);
    const averageCostCents = (totalCostCents + BigInt(newQuantity) / 2n) / BigInt(newQuantity);
    const updated = await tx.product.updateMany({
      where: { id, telegramId: req.telegramId, quantity: product.quantity, unitCost: product.unitCost },
      data: { quantity: newQuantity, unitCost: centsToMoney(averageCostCents) },
    });
    if (!updated.count) return { error: "Stock changed while restocking. Please try again", status: 409 };
    return { product: await tx.product.findUnique({ where: { id } }) };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result.product);
});

app.post("/api/products/:id/sales", async (req, res) => {
  const id = Number(req.params.id);
  const quantity = Number(req.body.quantity);
  const unitPrice = String(req.body.unitPrice ?? "").trim();
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid product id" });
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000000) {
    return res.status(400).json({ error: "quantity must be a positive whole number" });
  }
  if (!MONEY_PATTERN.test(unitPrice) || Number(unitPrice) <= 0) {
    return res.status(400).json({ error: "unitPrice must be positive, with up to 12 whole digits and 2 decimal places" });
  }

  const product = await prisma.product.findFirst({ where: { id, telegramId: req.telegramId } });
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (product.unitCost === null) return res.status(409).json({ error: "Set this product's unit cost before recording sales" });

  const totalCents = moneyToCents(unitPrice) * BigInt(quantity);
  const costTotalCents = moneyToCents(product.unitCost) * BigInt(quantity);
  if (totalCents > MAX_MONEY_CENTS) return res.status(400).json({ error: "Sale total exceeds the supported amount" });
  if (costTotalCents > MAX_MONEY_CENTS) return res.status(400).json({ error: "Sale cost exceeds the supported amount" });
  if (product.quantity < quantity) return res.status(409).json({ error: "Not enough stock for this sale" });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.updateMany({
      where: { id, telegramId: req.telegramId, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    if (!updated.count) return null;

    const total = centsToMoney(totalCents);
    const costTotal = centsToMoney(costTotalCents);
    const profit = centsToMoney(totalCents - costTotalCents);
    const income = await tx.transaction.create({
      data: {
        telegramId: req.telegramId,
        type: "INCOME",
        amount: total,
        category: "Business",
        reason: `Sale: ${product.name} x ${quantity}`,
      },
    });
    const sale = await tx.sale.create({
      data: {
        telegramId: req.telegramId,
        productId: id,
        transactionId: income.id,
        quantity,
        unitCost: product.unitCost,
        unitPrice,
        total,
        costTotal,
        profit,
      },
      include: { product: { select: { name: true } } },
    });
    const remaining = await tx.product.findUnique({ where: { id }, select: { quantity: true } });
    return { sale, remainingStock: remaining.quantity };
  });

  if (!result) return res.status(409).json({ error: "Not enough stock for this sale" });
  res.json(result);
});

app.get("/api/sales", async (req, res) => {
  const sales = await prisma.sale.findMany({
    where: { telegramId: req.telegramId },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json(sales);
});

app.get("/api/sales/summary", async (req, res) => {
  const periods = ["today", "week", "month", "year"];
  const summaries = await Promise.all(periods.map(async (period) => {
    const { start, end } = getRange(period);
    const aggregate = await prisma.sale.aggregate({
      where: { telegramId: req.telegramId, createdAt: { gte: start, lt: end } },
      _sum: { total: true, profit: true, quantity: true },
      _count: { _all: true },
    });
    return [period, {
      totalSales: String(aggregate._sum.total ?? "0.00"),
      profit: String(aggregate._sum.profit ?? "0.00"),
      saleCount: aggregate._count._all,
      itemsSold: aggregate._sum.quantity ?? 0,
    }];
  }));
  res.json(Object.fromEntries(summaries));
});

app.get("/api/products/export.csv", async (req, res) => {
  const products = await prisma.product.findMany({
    where: { telegramId: req.telegramId },
    orderBy: { name: "asc" },
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="stock-inventory.csv"');
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(productsToCsv(products));
});

app.get("/api/sales/export.csv", async (req, res) => {
  if (typeof req.query.from !== "string" || typeof req.query.to !== "string" || req.query.from > req.query.to) {
    return res.status(400).json({ error: "Provide a valid start date on or before the end date." });
  }
  const from = parseDateBoundary(req.query.from, req.query.fromOffset);
  const until = parseDateBoundary(req.query.to, req.query.toOffset, true);
  if (!from || !until || from >= until) {
    return res.status(400).json({ error: "Provide a valid start date and end date, with start on or before end." });
  }

  const sales = await prisma.sale.findMany({
    where: { telegramId: req.telegramId, createdAt: { gte: from, lt: until } },
    include: { product: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sales-${req.query.from}-to-${req.query.to}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(salesToCsv(sales));
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// --- start ---------------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  Promise.resolve(startBot()).catch((err) => {
    console.error("Telegram bot failed to start:", err);
  });
});

process.once("SIGINT", () => {
  if (!process.env.TELEGRAM_WEBHOOK_URL) bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  if (!process.env.TELEGRAM_WEBHOOK_URL) bot.stop("SIGTERM");
});
