// Dev-only helper: produces a validly-signed Telegram initData string so you
// can test the API directly (curl/Postman) without opening real Telegram.
// This only works because it's run with YOUR bot token, server-side — it's
// not something an outside attacker could reproduce.
//
// Usage:
//   node scripts/generate-dev-init-data.js [telegramUserId]
//
// Then:
//   curl http://localhost:3000/api/summary/all \
//     -H "X-Telegram-Init-Data: <paste the output>"

require("dotenv").config();
const crypto = require("crypto");

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("Set BOT_TOKEN in your .env first.");
  process.exit(1);
}

const userId = process.argv[2] || "999999";
const user = JSON.stringify({ id: Number(userId), first_name: "Dev", username: "dev_user" });
const authDate = Math.floor(Date.now() / 1000);

const params = new URLSearchParams({
  auth_date: String(authDate),
  query_id: "AAdev_query_id",
  user,
});

const dataCheckString = [...params.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");

const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

params.set("hash", hash);

console.log(params.toString());
