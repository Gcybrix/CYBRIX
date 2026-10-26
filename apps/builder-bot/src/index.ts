/** CYBRIX Builder Bot — Cloudflare Worker entrypoint. */
import type { Env, TgUpdate } from './types';
import { ensureSchema, now } from './db';
import { Tg } from './tg';
import { handleUpdate } from './install';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
let cachedBotUsername = '';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      await ensureSchema(env.DB);
      let db = 'ok';
      try {
        await env.DB.prepare(`SELECT 1`).first();
      } catch {
        db = 'fail';
      }
      return new Response(
        JSON.stringify({ ok: true, service: 'cybrix-builder-bot', version: env.VERSION, db }),
        { headers: JSON_HEADERS }
      );
    }

    if (request.method === 'GET' && url.pathname === '/') {
      if (!cachedBotUsername) {
        try {
          const me = await new Tg(env.BOT_TOKEN).getMe();
          if (me?.username) cachedBotUsername = me.username;
        } catch {
          /* page renders without the deep link */
        }
      }
      const link = cachedBotUsername
        ? `<p><a style="color:#39ff8b" href="https://t.me/${cachedBotUsername}">🚀 شروع نصب در تلگرام</a></p>`
        : '';
      return new Response(
        `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYBRIX Builder — استقرار نسخه اختصاصی شما</title><style>body{background:#05090f;color:#39ff8b;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;max-width:640px;padding:24px}h1{letter-spacing:6px;margin:0 0 8px}p{color:#8fd9a0;line-height:1.9}a{color:#39ff8b}</style></head>
<body><div><h1>CYBRIX</h1><p>🛠 <b>Builder — استقرار نسخه اختصاصی شما</b></p>
<p>بات چالش + پنل وب CYBRIX را روی حساب Cloudflare خودتان نصب کنید؛ با توکن بات و توکن Cloudflare خودتان. توکن‌ها فقط موقتاً استفاده و بلافاصله حذف می‌شوند.</p>
<p>✅ سرویس فعال است — v${env.VERSION}</p>${link}</div></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (env.WEBHOOK_SECRET) {
        const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (secret !== env.WEBHOOK_SECRET) {
          return new Response('forbidden', { status: 403 });
        }
      }
      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return new Response('ok');
      }
      // idempotency — same pattern as the central bot
      try {
        await ensureSchema(env.DB);
        const dup = await env.DB
          .prepare(`INSERT INTO webhook_events (update_id, processed_at) VALUES (?,?) ON CONFLICT DO NOTHING`)
          .bind(update.update_id, now())
          .run();
        if ((dup.meta?.changes ?? 0) === 0) return new Response('ok'); // duplicate
      } catch {
        return new Response('ok'); // fail-safe: never block Telegram retries forever
      }
      ctx.waitUntil(handleUpdate(env, update).catch((e) => console.error('builder update failed', e)));
      return new Response('ok');
    }

    return new Response(
      JSON.stringify({ service: 'cybrix-builder-bot', version: env.VERSION }),
      { headers: JSON_HEADERS }
    );
  },
};
