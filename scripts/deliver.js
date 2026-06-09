#!/usr/bin/env node

// AI R&D Digest delivery helper.
// Sends a final digest text through stdout, Telegram, or Resend email.

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const USER_DIR = process.env.AITRENDPUSH_USER_DIR || join(homedir(), ".ai-trend-push");
const CONFIG_PATH = join(USER_DIR, "config.json");
const ENV_PATH = join(USER_DIR, ".env");

async function readJSON(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = await readFile(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getDigestText() {
  const args = process.argv.slice(2);
  const messageIndex = args.indexOf("--message");
  if (messageIndex !== -1 && args[messageIndex + 1]) {
    return args[messageIndex + 1];
  }

  const fileIndex = args.indexOf("--file");
  if (fileIndex !== -1 && args[fileIndex + 1]) {
    return readFile(args[fileIndex + 1], "utf8");
  }

  return readStdin();
}

function chunkText(text, limit = 3900) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.5) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendTelegram(text, delivery) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = delivery.chatId;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is missing from ~/.ai-trend-push/.env");
  if (!chatId) throw new Error("delivery.chatId is missing from ~/.ai-trend-push/config.json");

  for (const chunk of chunkText(text)) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`.trim();
      try {
        const body = await response.json();
        detail = body.description || JSON.stringify(body);
      } catch {}
      throw new Error(`Telegram API error: ${detail}`);
    }
  }
}

async function sendEmail(text, delivery) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = delivery.email;
  const fromEmail = delivery.fromEmail || process.env.RESEND_FROM_EMAIL || "AI R&D Digest <digest@resend.dev>";
  if (!apiKey) throw new Error("RESEND_API_KEY is missing from ~/.ai-trend-push/.env");
  if (!toEmail) throw new Error("delivery.email is missing from ~/.ai-trend-push/config.json");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: `AI R&D Digest - ${new Date().toISOString().slice(0, 10)}`,
      text,
    }),
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`.trim();
    try {
      const body = await response.json();
      detail = body.message || JSON.stringify(body);
    } catch {}
    throw new Error(`Resend API error: ${detail}`);
  }
}

async function main() {
  await loadDotEnv(ENV_PATH);
  const config = await readJSON(CONFIG_PATH);
  const delivery = config.delivery || { method: "stdout" };
  const digestText = await getDigestText();

  if (!digestText.trim()) {
    console.log(JSON.stringify({ status: "skipped", reason: "empty digest text" }));
    return;
  }

  if (!delivery.method || delivery.method === "stdout") {
    console.log(digestText);
    return;
  }

  try {
    if (delivery.method === "telegram") {
      await sendTelegram(digestText, delivery);
    } else if (delivery.method === "email") {
      await sendEmail(digestText, delivery);
    } else {
      throw new Error(`Unsupported delivery method: ${delivery.method}`);
    }
    console.log(JSON.stringify({ status: "ok", method: delivery.method }));
  } catch (error) {
    console.log(JSON.stringify({ status: "error", method: delivery.method, message: error.message }));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: error.message }));
  process.exit(1);
});
