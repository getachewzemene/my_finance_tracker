require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const prisma = require("./db");
const { validateInitData, AuthError } = require("./auth");
const { computeSummary, computeAllSummaries } = require("./summaryService");
const { bot, launchBot } = require("./bot");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

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

  if (!["INCOME", "EXPENSE"].includes(type)) {
    return res.status(400).json({ error: "type must be INCOME or EXPENSE" });
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "reason is required" });
  }

  const tx = await prisma.transaction.create({
    data: {
      telegramId: req.telegramId,
      type,
      amount: parsedAmount,
      reason: String(reason).trim().slice(0, 200),
    },
  });

  res.json(tx);
});

// List recent transactions for the authenticated user
app.get("/api/transactions", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const rows = await prisma.transaction.findMany({
    where: { telegramId: req.telegramId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(rows);
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

app.get("/health", (_req, res) => res.json({ ok: true }));

// --- start ---------------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  launchBot();
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
