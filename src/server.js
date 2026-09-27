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
const { transactionsToCsv } = require("./csvExport");
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
