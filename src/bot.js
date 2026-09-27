const { Telegraf, Markup } = require("telegraf");
const { computeAllSummaries } = require("./summaryService");

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
    const fmt = (n) => n.toFixed(2);
    ctx.reply(
      `📅 This week: income ${fmt(data.week.income)} · expense ${fmt(
        data.week.expense
      )} · net ${fmt(data.week.net)}\n` +
        `🗓️ This month: income ${fmt(data.month.income)} · expense ${fmt(
          data.month.expense
        )} · net ${fmt(data.month.net)}\n` +
        `📆 This year: income ${fmt(data.year.income)} · expense ${fmt(
          data.year.expense
        )} · net ${fmt(data.year.net)}`
    );
  } catch (err) {
    console.error(err);
    ctx.reply("Couldn't fetch your summary right now.");
  }
});

function launchBot() {
  if (!BOT_TOKEN) {
    console.warn("BOT_TOKEN not set — skipping Telegram bot startup.");
    return;
  }
  bot.launch();
  console.log("Telegram bot started (long polling).");
}

module.exports = { bot, launchBot };
