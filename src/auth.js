// Verifies Telegram Mini App "initData" per Telegram's documented scheme:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// The Mini App is served over HTTPS and loaded by the Telegram client, which
// signs a payload (initData) with a hash derived from the bot token. Only
// someone holding the bot token can produce a valid hash, so a verified
// initData proves the request really came from that Telegram user, in that
// session — the client can no longer just claim to be any userId.

const crypto = require("crypto");

class AuthError extends Error {}

/**
 * @param {string} initData   Raw initData string sent by the Mini App client.
 * @param {string} botToken   Your bot's token (server-side secret, never sent to the client).
 * @param {object} [options]
 * @param {number} [options.maxAgeSeconds=86400] Reject init data older than this (replay protection).
 * @returns {{ user: { id: number, [k:string]: any }, authDate: number }}
 */
function validateInitData(initData, botToken, options = {}) {
  const maxAgeSeconds = options.maxAgeSeconds ?? 24 * 60 * 60;

  if (!botToken) {
    throw new AuthError("Server misconfigured: BOT_TOKEN is not set");
  }
  if (!initData || typeof initData !== "string") {
    throw new AuthError("Missing Telegram init data");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new AuthError("Init data missing hash");
  }
  params.delete("hash");

  // Build the data-check-string: all remaining fields, sorted by key, "key=value" joined by \n
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time comparison
  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AuthError("Invalid init data signature");
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Number.isNaN(authDate)) {
    throw new AuthError("Init data missing auth_date");
  }
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds) {
    throw new AuthError("Init data has expired — reopen the Mini App");
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new AuthError("Init data missing user");
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new AuthError("Init data has malformed user field");
  }
  if (!user || !user.id) {
    throw new AuthError("Init data missing user id");
  }

  return { user, authDate };
}

module.exports = { validateInitData, AuthError };
