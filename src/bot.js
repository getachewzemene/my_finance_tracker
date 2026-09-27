const { Telegraf, Markup } = require("telegraf");
const { computeAllSummaries } = require("./summaryService");
const { CURRENCY_CODE } = require("./currency");

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

const bot = new Telegraf(BOT_TOKEN);

function openAppKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.webApp("📊 Open Tracker", WEBAPP_URL),
  ]);
}

bot.start((ctx) => {
  ctx.reply(
    "Welcome! Track your income and expenses, with a reason for each entry.\n\n" +
      "Tap the button below to open the tracker.",
    openAppKeyboard()
  );
});

bot.command("app", (ctx) => {
  ctx.reply("Open your tracker:", openAppKeyboard());
});

bot.command("summary", async (ctx) => {
  // ctx.from.id is authenticated by Telegram itself (this update only exists
  // because Telegram's servers delivered it to our bot via BOT_TOKEN), so we
  // can trust it directly — no need to round-trip through the HTTP API.
  const telegramId = String(ctx.from.id);
  try {
    const data = await computeAllSummaries(telegramId);
    ctx.reply(
      `📅 This week: income ${CURRENCY_CODE} ${data.week.income} · expense ${CURRENCY_CODE} ${
        data.week.expense
      } · net ${CURRENCY_CODE} ${data.week.net}\n` +
        `🗓️ This month: income ${CURRENCY_CODE} ${data.month.income} · expense ${CURRENCY_CODE} ${
          data.month.expense
        } · net ${CURRENCY_CODE} ${data.month.net}\n` +
        `📆 This year: income ${CURRENCY_CODE} ${data.year.income} · expense ${CURRENCY_CODE} ${
          data.year.expense
        } · net ${CURRENCY_CODE} ${data.year.net}`
    );
  } catch (err) {
    console.error(err);
    ctx.reply("Couldn't fetch your summary right now.");
  }
});

function configureBot(app) {
  if (!BOT_TOKEN) {
    return () => console.warn("BOT_TOKEN not set — skipping Telegram bot startup.");
  }

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (!webhookUrl) {
    return () => {
      bot.launch().catch((err) => console.error("Telegram bot failed to start:", err));
      console.log("Telegram bot started (long polling).");
    };
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_WEBHOOK_URL is set");
  }

  const parsedWebhookUrl = new URL(webhookUrl);
  if (parsedWebhookUrl.protocol !== "https:" || parsedWebhookUrl.pathname === "/") {
    throw new Error("TELEGRAM_WEBHOOK_URL must be HTTPS and include a non-root path");
  }

  const webhookPath = parsedWebhookUrl.pathname;
  app.post(
    webhookPath,
    bot.webhookCallback(webhookPath, { secretToken: webhookSecret })
  );

  return async () => {
    await bot.telegram.setWebhook(webhookUrl, { secret_token: webhookSecret });
    console.log("Telegram bot started (webhook).");
  };
}

module.exports = { bot, configureBot };
