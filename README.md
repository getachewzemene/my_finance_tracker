# Financial Tracker — Telegram Bot + Mini App

A simple income/expense tracker. Every entry has a type (income or expense),
an amount, and a reason. The Mini App shows weekly, monthly, and yearly
totals (income, expense, net).

## Stack

- **Bot**: Telegraf (Telegram Bot API, long polling)
- **Backend**: Express (serves the Mini App + a small JSON API)
- **DB**: SQLite via Prisma (zero setup, one file)
- **Frontend**: Plain HTML/CSS/JS using the Telegram WebApp SDK — no build step

## Project layout

```
financial-tracker-bot/
├── prisma/schema.prisma   # Transaction model (type, amount, reason, telegramId)
├── src/
│   ├── server.js          # Express app + API routes
│   ├── bot.js             # Telegram bot, /start /app /summary
│   ├── db.js              # Prisma client
│   └── utils/dateRanges.js
├── public/
│   ├── index.html          # Mini App UI
│   ├── style.css
│   └── app.js               # Form + summary + list logic, calls the API
└── .env.example
```

## Auth — how unauthorized access is prevented

The Mini App is loaded inside Telegram, which hands it a signed `initData`
string (Telegram docs: [Validating data received via the Mini App](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)).
Every API call sends that raw string in an `X-Telegram-Init-Data` header.

On the server (`src/auth.js`, wired in as middleware in `src/server.js`):

1. The `hash` field is stripped out and the remaining fields are sorted and
   joined into a "data-check string".
2. An HMAC-SHA256 of that string, keyed with a secret derived from
   `BOT_TOKEN`, must exactly match the `hash` Telegram sent. Only someone
   holding the bot token can produce a matching hash — so a client can no
   longer just claim to be any user.
3. `auth_date` is checked against `INIT_DATA_MAX_AGE_SECONDS` (default 24h)
   to reject stale/replayed sessions.
4. The Telegram user id is read **from the verified payload**, never from a
   query param or request body. Every route uses that id, so a user can only
   ever read, add, or delete their **own** transactions — requesting another
   user's data (or someone else's transaction id) returns `401`/`404`.

The bot's own `/summary` command doesn't need this check: it runs inside the
bot process and uses `ctx.from.id`, which Telegram itself already vouched for
by delivering that update through your bot token.

**Testing locally without opening real Telegram:** you can't fabricate a
valid `initData` without the bot token, so use the included helper, which
signs one with your own token:

```bash
node scripts/generate-dev-init-data.js 12345      # any fake user id
# copy the output, then:
curl http://localhost:3000/api/summary/all \
  -H "X-Telegram-Init-Data: <paste output here>"
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create your bot**
   - Talk to [@BotFather](https://t.me/BotFather) on Telegram → `/newbot`
   - Copy the token it gives you.

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   - `BOT_TOKEN` — from BotFather
   - `WEBAPP_URL` — the public HTTPS URL this server will run on (Telegram
     Mini Apps require HTTPS; for local dev use a tunnel like `ngrok http 3000`
     and paste its `https://...` URL here)

4. **Set up the database**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```
   This creates `prisma/dev.db` (SQLite) with the `Transaction` table.

5. **Run**
   ```bash
   npm start
   ```
   This starts the Express server (serving the Mini App + API) and the
   Telegram bot together.

6. **Try it**
   - Open your bot in Telegram, send `/start`
   - Tap **📊 Open Tracker** to launch the Mini App
   - Add an income or expense with a reason — the week/month/year cards
     update immediately
   - `/summary` gives a text-only version of the same numbers, without
     opening the app

## API (used by the Mini App, but plain REST if you want to test it directly)

| Method | Path | Body / Query | Description |
|---|---|---|---|
| POST | `/api/transactions` | `{ userId, type: "INCOME"\|"EXPENSE", amount, reason }` | Add an entry |
| GET | `/api/transactions?userId=&limit=` | — | Recent entries for a user |
| DELETE | `/api/transactions/:id?userId=` | — | Delete one entry |
| GET | `/api/summary?userId=&period=week\|month\|year` | — | Totals for one period |
| GET | `/api/summary/all?userId=` | — | Week + month + year totals in one call |

Every row above requires the `X-Telegram-Init-Data` header — there is no
`userId` parameter anymore. The user id is derived server-side from the
verified init data (see **Auth**, above).

## Notes on scope (kept deliberately simple)

- One table, one type field (income/expense) — no categories, no
  multi-currency, no recurring entries. Easy to extend later if needed.
- "Week" = Monday–Sunday of the current calendar week; "month"/"year" are
  calendar month/year — not rolling 7/30/365-day windows.
- Auth relies on Telegram's initData signature, not a separate password/login —
  appropriate for a Mini App, since Telegram itself is the identity provider.
- Deploying: any Node host with HTTPS works (Render, Railway, Fly.io, a VPS
  behind a reverse proxy). Swap `DATABASE_URL` to Postgres/MySQL in
  `schema.prisma` if you outgrow SQLite — the rest of the code doesn't change.
