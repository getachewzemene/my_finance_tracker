# Financial Tracker — Telegram Bot + Mini App

A simple ETB income/expense tracker. Every entry has a type (income or expense),
an exact amount, and a reason. The Mini App shows weekly, monthly, and yearly
totals (income, expense, net).

## Stack

- **Bot**: Telegraf (Telegram Bot API, long polling)
- **Backend**: Express (serves the Mini App + a small JSON API)
- **DB**: PostgreSQL via Prisma (for example, Neon)
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
    - `WEBAPP_URL` — the public HTTPS URL of this app (Telegram Mini Apps
       require HTTPS)
    - `DATABASE_URL` — the PostgreSQL connection string from Neon
    - For Render, set `TELEGRAM_WEBHOOK_URL` to
       `https://<your-service>.onrender.com/telegram/webhook` and set
       `TELEGRAM_WEBHOOK_SECRET` to a random secret. Without these, the bot uses
       long polling, which is useful for local development.

4. **Set up the database**
   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```
   This applies the checked-in PostgreSQL migration to the database in
   `DATABASE_URL`. Use `npx prisma migrate dev` when creating new migrations
   during development.

   Prisma Client is also generated automatically after `npm install` or
   `npm ci`. In Render, use `npm ci` as the build command and
   `npx prisma migrate deploy && npm start` as the start command. Render runs
   Linux commands, so `&&` is valid there (unlike older Windows PowerShell).

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
| POST | `/api/transactions` | `{ type, amount, category, reason }` | Add an entry |
| GET | `/api/transactions?limit=&period=&type=` | — | Recent entries; period: all, today, week, month, or year; type: INCOME or EXPENSE |
| GET | `/api/transactions/export.csv?from=&to=` | — | Download the authenticated user's transactions for an inclusive date range |
| DELETE | `/api/transactions/:id?userId=` | — | Delete one entry |
| GET | `/api/summary?userId=&period=week\|month\|year` | — | Totals for one period |
| GET | `/api/summary/all?userId=` | — | Week + month + year totals in one call |
| GET | `/api/summary/categories?period=` | — | Category totals for today, week, month, or year, split by income and expense |
| GET | `/api/budgets` | — | Current-month spending against saved category budgets |
| POST | `/api/budgets` | `{ category, monthlyLimit }` | Create or update a recurring monthly expense budget |
| DELETE | `/api/budgets/:category` | — | Remove a category budget |

Every row above requires the `X-Telegram-Init-Data` header — there is no
`userId` parameter anymore. The user id is derived server-side from the
verified init data (see **Auth**, above).

## Notes on scope (kept deliberately simple)

- Categories are fixed: income uses Salary, Business, Investment, Gift, or
   Other; expenses use Food, Transport, Bills, Housing, Shopping, Health,
   Entertainment, or Other. Custom categories and recurring entries are not
   supported.
- ETB amounts are stored to two decimal places. The precision migration rounds
   existing entries to cents and tags them as ETB. Changing currency later
   requires a deliberate data conversion.
- Expense-category budgets recur monthly and send one Telegram alert at 80%
   and one when the limit is reached or exceeded.
- "Week" = Monday–Sunday of the current calendar week; "month"/"year" are
  calendar month/year — not rolling 7/30/365-day windows.
- Auth relies on Telegram's initData signature, not a separate password/login —
  appropriate for a Mini App, since Telegram itself is the identity provider.
- Deploying: the Prisma schema and checked-in migration target PostgreSQL.
   Render's free web service sleeps after inactivity, so configure the Telegram
   webhook variables above instead of relying on long polling. Neon Free scales
   its database to zero after inactivity and has storage/compute quotas. Existing
   data in a previous local SQLite `dev.db` file is not copied automatically.
