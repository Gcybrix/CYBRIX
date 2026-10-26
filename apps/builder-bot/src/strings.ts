/** CYBRIX Builder — bot strings (fa default / en). Same {placeholder} convention as shared i18n. */
import type { Lang } from '../../../packages/shared/src/i18n';

export type { Lang };

type Dict = Record<string, string>;

export const BUILDER_STRINGS: Record<Lang, Dict> = {
  fa: {
    b_welcome: '👋 به <b>CYBRIX Builder</b> خوش آمدید!\n\nاین بات نسخهٔ اختصاصی CYBRIX (بات چالش + پنل وب) را روی حساب Cloudflare خودتان نصب می‌کند — با توکن بات و توکن Cloudflare خودتان.',
    b_join_required: '🔒 برای استفاده از CYBRIX Builder ابتدا در کانال‌های رسمی عضو شوید:',
    b_check_again: '✅ عضویت را بررسی کن',
    b_join_btn: 'عضویت در کانال',
    b_menu: '🏠 منوی اصلی — CYBRIX Builder:',
    b_btn_install: '🚀 نصب نسخه اختصاصی (/install)',
    b_btn_status: '📦 نصب‌های من (/status)',
    b_btn_help: '📘 راهنما (/help)',
    b_help: '📘 راهنمای CYBRIX Builder\n\n/start — شروع و منوی اصلی\n/install — نصب نسخه اختصاصی (بات + پنل) روی Cloudflare شما\n/status — لیست نصب‌های شما\n/reinstall &lt;id&gt; — نصب مجدد یک نسخه (آپدیت باندل)\n/health &lt;id&gt; — بررسی سلامت ورکر/پنل/وب‌هوک\n/cancel — لغو عملیات جاری\n\n🔒 امنیت:\n• توکن‌ها فقط موقتاً در جریان نصب استفاده و بعد از آن حذف می‌شوند.\n• بعد از نصب، توکن‌ها را بچرخانید (BotFather /revoke + حذف توکن Cloudflare).',
    b_rate_limited: '⏳ کمی آرام‌تر — چند لحظه بعد تلاش کنید.',
    b_err_generic: '⚠️ خطایی رخ داد. دوباره تلاش کنید.',
    b_cancelled: '❌ عملیات لغو شد و توکن‌های موقت حذف شدند.',
    b_send_text: 'ℹ️ لطفاً از دکمه‌ها استفاده کنید یا پیام متنی بفرستید.',
    b_unknown: 'دستور نامشخص. از /help راهنما بگیرید.',

    b_ask_bot_token: '🚀 نصب نسخه اختصاصی CYBRIX — مرحله ۱/۴\n\nتوکن بات تلگرام <b>مشتری</b> را بفرستید (فرمت: <code>123456:ABC-DEF...</code>).\nاز BotFather → /mybots → API Token بگیرید. یک بات جدید بسازید، نه بات CYBRIX.',
    b_bad_bot_token: '❌ توکن نامعتبر است یا تلگرام آن را نپذیرفت ({err}).\nدوباره توکن را بفرستید یا /cancel.',
    b_own_bot_reject: '⛔ این توکن متعلق به بات نصب CYBRIX است!\nیک بات <b>جدید</b> از BotFather بسازید و توکن همان را بفرستید.',
    b_bot_ok: '✅ بات شناسایی شد: @{bot}\n\nمرحله ۲/۴ — توکن API حساب <b>Cloudflare خودتان</b> را بفرستید.\n(داشبورد → My Profile → API Tokens → Create Token)',
    b_webhook_warn: '⚠️ این بات هم‌اکنون وب‌هوک فعال دارد:\n{url}\nدر نصب، وب‌هوک جدید جایگزین آن می‌شود.',

    b_ask_cf_token: '☁️ توکن API حساب Cloudflare خودتان را بفرستید.\n\nدسترسی‌های لازم:\n• Account → Workers Scripts → Edit\n• Account → D1 → Edit\n• Account → Account Settings → Read',
    b_cf_invalid: '❌ توکن Cloudflare نامعتبر است {err}.\nدوباره بفرستید یا /cancel.',
    b_cf_no_accounts: '❌ این توکن به هیچ حساب Cloudflare دسترسی ندارد.\nیک توکن با دسترسی <b>Account Settings: Read</b> بسازید و دوباره بفرستید.',
    b_cf_accounts_fail: '❌ گرفتن لیست حساب‌ها ممکن نشد {err}.\nتوکن باید دسترسی <b>Account Settings: Read</b> داشته باشد.',
    b_pick_account: '☁️ بیش از یک حساب پیدا شد — حساب مقصد را انتخاب کنید:',
    b_perm_missing: '❌ توکن دسترسی‌های لازم را ندارد. گمشده: <b>{missing}</b>\n\nراهنما: هنگام ساخت توکن این دسترسی‌ها را بدهید:\n• Account → Workers Scripts → Edit\n• Account → D1 → Edit\n• Account → Account Settings → Read\nسپس توکن را دوباره بفرستید.',

    b_names_intro: '✅ دسترسی‌ها تأیید شد — مرحله ۳/۴\n\nنام منابع پیشنهادی:\n\n• ورکر بات: <code>{worker}</code>\n• ورکر پنل: <code>{panel}</code>\n• دیتابیس D1: <code>{db}</code>\n\n{warn}\nاگر موافقید دکمه را بزنید، یا نام دلخواه‌تان را بفرستید.',
    b_names_warn_db: '⚠️ دیتابیس‌ای با همین نام موجود است و <b>مجدداً استفاده</b> می‌شود.\n',
    b_names_warn_worker: '⚠️ ورکری با همین نام موجود است؛ محتوایش بازنویسی می‌شود.\n',
    b_names_bad: '❌ نام نامعتبر است. فقط حروف انگلیسی کوچک، رقم و خط تیره (حداکثر ۳۰ کاراکتر).\nدوباره بفرستید یا /cancel.',
    b_btn_names_ok: '✅ همین نام‌ها خوب است',

    b_confirm: '📋 خلاصه نصب — مرحله ۴/۴\n\n• بات: @{bot}\n• حساب CF: {account}\n• ورکر بات: <code>{worker}</code>\n• ورکر پنل: <code>{panel}</code>\n• دیتابیس D1: <code>{db}</code>\n• نسخه باندل: {version}\n{dbwarn}\n⚠️ <b>هشدارهای امنیتی</b>:\n• توکن بات و توکن Cloudflare فقط <b>موقتاً</b> استفاده و بلافاصله پس از نصب از دیتابیس بیلدر حذف می‌شوند.\n• پس از نصب توکن‌ها را بچرخانید: BotFather → /revoke و حذف توکن Cloudflare از داشبورد.\n• وب‌هوک بات شما روی ورکر جدید تنظیم می‌شود.\n\nتأیید می‌کنید؟',
    b_btn_confirm: '✅ تأیید و شروع نصب',

    b_exec_running: '⚙️ استقرار CYBRIX روی Cloudflare شما...',
    b_exec_stopped: '⛔ استقرار متوقف شد — می‌توانید دوباره تلاش کنید:',
    b_step_d1: 'ساخت/یافتن دیتابیس D1',
    b_step_bot: 'آپلود ورکر بات',
    b_step_subdomain: 'فعال‌سازی subdomain بات',
    b_step_panel: 'آپلود ورکر پنل',
    b_step_panel_sub: 'فعال‌سازی subdomain پنل',
    b_step_webhook: 'تنظیم وب‌هوک بات',
    b_step_health: 'بررسی سلامت سرویس‌ها',
    b_step_save: 'ثبت نهایی و پاک‌سازی توکن‌ها',
    b_exec_failed: '❌ مرحله «{step}» ناموفق بود:\n<code>{err}</code>',
    b_exec_detail_reused: 'موجود — استفاده مجدد',
    b_btn_retry: '🔁 تلاش مجدد',

    b_install_done: '🎉 <b>نصب کامل شد!</b>\n\n🤖 بات: https://t.me/{bot}\n⚙️ ورکر: {worker_url}\n🖥 پنل: {panel_url}\n📦 نسخه: {version}\n\n<b>قدم‌های بعدی:</b>\n۱) بات جدید را ادمین کانال‌های خودش کنید (اجازه ارسال پیام).\n۲) در بات جدید دستور /panel را بزنید تا کد ورود پنل بگیرید.\n۳) امنیت: توکن بات را با BotFather → /revoke بچرخانید و توکن Cloudflare را از داشبورد حذف کنید.',

    b_status_none: 'هنوز نصبی ثبت نکرده‌اید. با /install شروع کنید.',
    b_status_list: '📦 نصب‌های شما:\n\n{list}',
    b_status_item: '<b>#{id}</b> • @{bot} — {status} • نسخه {version}\n⚙️ {worker_url}\n🖥 {panel_url}\n',

    b_reinstall_usage: 'استفاده: /reinstall &lt;id&gt; — شناسه را از /status بگیرید.',
    b_reinstall_notfound: '❌ نصب #{id} برای شما پیدا نشد.',
    b_reinstall_ask_bot: '🔁 نصب مجدد #{id} (@{bot})\n\nتوکن‌ها ذخیره نمی‌شوند؛ برای ادامه توکن بات مشتری را دوباره بفرستید.',
    b_reinstall_ask_cf: '✅ بات تأیید شد: @{bot}\n\nحالا توکن Cloudflare را بفرستید (همان حساب قبلی یا حساب دیگر).',
    b_reinstall_done: '✅ نصب مجدد #{id} انجام شد.\n\n🤖 https://t.me/{bot}\n⚙️ {worker_url}\n🖥 {panel_url}\n📦 نسخه: {version}\n\nتوکن‌های موقت حذف شدند. در صورت نیاز دوباره بچرخانید.',

    b_health_usage: 'استفاده: /health &lt;id&gt;',
    b_health_notfound: '❌ نصب #{id} برای شما پیدا نشد.',
    b_health_ask_token: '🩺 بررسی سلامت #{id}\n\n• ورکر: {worker_ok}\n• پنل: {panel_ok}\n\nبرای بررسی وب‌هوک، توکن بات مشتری را بفرستید (فقط برای همین بررسی؛ ذخیره نمی‌شود). یا /cancel.',
    b_health_ok: '✅ سالم',
    b_health_fail: '❌ پاسخ نداد',
    b_health_report: '🩺 گزارش وب‌هوک #{id}:\n\n• توکن: توکن بات @{bot} تأیید شد\n• وب‌هوک: {hook}\n• URL وب‌هوک: {url}',
    b_hook_empty: 'وب‌هوکی تنظیم نیست ⚠️ (بات پاسخ نمی‌دهد)',
    b_hook_ok: '✅ درست روی ورکر تنظیم است',
    b_hook_mismatch: '⚠️ به آدرس دیگری اشاره می‌کند:\n{url}',
    b_health_bad_token: '❌ این توکن بات @{bot} است، نه @{expect}. توکن درست را بفرستید یا /cancel.',
    b_health_invalid_token: '❌ توکن نامعتبر است ({err}). دوباره بفرستید یا /cancel.',
  },
  en: {
    b_welcome: '👋 Welcome to <b>CYBRIX Builder</b>!\n\nThis bot installs your own standalone CYBRIX (challenge bot + web panel) on YOUR OWN Cloudflare account — using your bot token and your Cloudflare token.',
    b_join_required: '🔒 To use CYBRIX Builder, first join our official channels:',
    b_check_again: '✅ Check membership',
    b_join_btn: 'Join channel',
    b_menu: '🏠 Main menu — CYBRIX Builder:',
    b_btn_install: '🚀 Install Standalone (/install)',
    b_btn_status: '📦 My Installations (/status)',
    b_btn_help: '📘 Guide (/help)',
    b_help: '📘 CYBRIX Builder Guide\n\n/start — start & main menu\n/install — install standalone (bot + panel) on your Cloudflare\n/status — list your installations\n/reinstall &lt;id&gt; — reinstall one (bundle update)\n/health &lt;id&gt; — check worker/panel/webhook health\n/cancel — cancel current flow\n\n🔒 Security:\n• Tokens are used transiently during the flow and deleted afterwards.\n• Rotate tokens after install (BotFather /revoke + delete the Cloudflare token).',
    b_rate_limited: '⏳ Slow down a bit — try again shortly.',
    b_err_generic: '⚠️ Something went wrong. Please try again.',
    b_cancelled: '❌ Cancelled — transient tokens wiped.',
    b_send_text: 'ℹ️ Please use the buttons or send a text message.',
    b_unknown: 'Unknown command. See /help.',

    b_ask_bot_token: '🚀 Standalone install — step 1/4\n\nSend the <b>customer</b> Telegram bot token (format: <code>123456:ABC-DEF...</code>).\nGet it from BotFather → /mybots → API Token. Create a NEW bot, not the CYBRIX one.',
    b_bad_bot_token: '❌ Invalid token or Telegram rejected it ({err}).\nSend it again or /cancel.',
    b_own_bot_reject: '⛔ This token belongs to the CYBRIX builder bot!\nCreate a <b>new</b> bot via BotFather and send that token.',
    b_bot_ok: '✅ Bot identified: @{bot}\n\nStep 2/4 — send the API token of <b>your own Cloudflare account</b>.\n(Dashboard → My Profile → API Tokens → Create Token)',
    b_webhook_warn: '⚠️ This bot already has an active webhook:\n{url}\nThe new install will overwrite it.',

    b_ask_cf_token: '☁️ Send your own Cloudflare API token.\n\nRequired permissions:\n• Account → Workers Scripts → Edit\n• Account → D1 → Edit\n• Account → Account Settings → Read',
    b_cf_invalid: '❌ Invalid Cloudflare token {err}.\nSend it again or /cancel.',
    b_cf_no_accounts: '❌ This token cannot see any Cloudflare account.\nCreate a token with <b>Account Settings: Read</b> and send it again.',
    b_cf_accounts_fail: '❌ Could not list accounts {err}.\nThe token needs <b>Account Settings: Read</b>.',
    b_pick_account: '☁️ More than one account found — pick the target account:',
    b_perm_missing: '❌ The token is missing required permissions. Missing: <b>{missing}</b>\n\nGuide: when creating the token grant:\n• Account → Workers Scripts → Edit\n• Account → D1 → Edit\n• Account → Account Settings → Read\nThen send the token again.',

    b_names_intro: '✅ Permissions verified — step 3/4\n\nProposed resource names:\n\n• Bot worker: <code>{worker}</code>\n• Panel worker: <code>{panel}</code>\n• D1 database: <code>{db}</code>\n\n{warn}\nTap the button to accept, or send a custom name.',
    b_names_warn_db: '⚠️ A database with this name exists and will be <b>reused</b>.\n',
    b_names_warn_worker: '⚠️ A worker with this name exists; its content will be overwritten.\n',
    b_names_bad: '❌ Invalid name. Use only lowercase letters, digits and dashes (max 30 chars).\nSend again or /cancel.',
    b_btn_names_ok: '✅ Keep these names',

    b_confirm: '📋 Install summary — step 4/4\n\n• Bot: @{bot}\n• CF account: {account}\n• Bot worker: <code>{worker}</code>\n• Panel worker: <code>{panel}</code>\n• D1 database: <code>{db}</code>\n• Bundle version: {version}\n{dbwarn}\n⚠️ <b>Security notes</b>:\n• The bot token and Cloudflare token are used <b>transiently</b> and DELETED from the builder DB right after the install.\n• Rotate tokens after install: BotFather → /revoke and delete the Cloudflare token from the dashboard.\n• Your bot\'s webhook will be repointed to the new worker.\n\nConfirm?',
    b_btn_confirm: '✅ Confirm & Install',

    b_exec_running: '⚙️ Deploying CYBRIX to your Cloudflare...',
    b_exec_stopped: '⛔ Deployment stopped — you can retry:',
    b_step_d1: 'Create/find D1 database',
    b_step_bot: 'Upload bot worker',
    b_step_subdomain: 'Enable bot subdomain',
    b_step_panel: 'Upload panel worker',
    b_step_panel_sub: 'Enable panel subdomain',
    b_step_webhook: 'Set bot webhook',
    b_step_health: 'Health checks',
    b_step_save: 'Finalize & wipe tokens',
    b_exec_failed: '❌ Step "{step}" failed:\n<code>{err}</code>',
    b_exec_detail_reused: 'existing — reused',
    b_btn_retry: '🔁 Retry',

    b_install_done: '🎉 <b>Install complete!</b>\n\n🤖 Bot: https://t.me/{bot}\n⚙️ Worker: {worker_url}\n🖥 Panel: {panel_url}\n📦 Version: {version}\n\n<b>Next steps:</b>\n1) Add the new bot as admin to its channels (post permission).\n2) Send /panel to the new bot to get a panel login code.\n3) Security: rotate the bot token via BotFather → /revoke and delete the Cloudflare token.',

    b_status_none: 'No installations yet. Start with /install.',
    b_status_list: '📦 Your installations:\n\n{list}',
    b_status_item: '<b>#{id}</b> • @{bot} — {status} • v{version}\n⚙️ {worker_url}\n🖥 {panel_url}\n',

    b_reinstall_usage: 'Usage: /reinstall &lt;id&gt; — get the id from /status.',
    b_reinstall_notfound: '❌ Installation #{id} not found for you.',
    b_reinstall_ask_bot: '🔁 Reinstall #{id} (@{bot})\n\nTokens are never persisted; send the customer bot token again to continue.',
    b_reinstall_ask_cf: '✅ Bot verified: @{bot}\n\nNow send the Cloudflare token (same account or another one).',
    b_reinstall_done: '✅ Reinstall #{id} finished.\n\n🤖 https://t.me/{bot}\n⚙️ {worker_url}\n🖥 {panel_url}\n📦 Version: {version}\n\nTransient tokens were wiped. Rotate them if needed.',

    b_health_usage: 'Usage: /health &lt;id&gt;',
    b_health_notfound: '❌ Installation #{id} not found for you.',
    b_health_ask_token: '🩺 Health check #{id}\n\n• Worker: {worker_ok}\n• Panel: {panel_ok}\n\nTo check the webhook, send the customer bot token (used only for this check; never stored). Or /cancel.',
    b_health_ok: '✅ healthy',
    b_health_fail: '❌ not responding',
    b_health_report: '🩺 Webhook report #{id}:\n\n• Token: verified for @{bot}\n• Webhook: {hook}\n• Webhook URL: {url}',
    b_hook_empty: 'no webhook set ⚠️ (bot will not respond)',
    b_hook_ok: '✅ correctly pointing to the worker',
    b_hook_mismatch: '⚠️ points elsewhere:\n{url}',
    b_health_bad_token: '❌ This token belongs to @{bot}, not @{expect}. Send the right token or /cancel.',
    b_health_invalid_token: '❌ Invalid token ({err}). Send it again or /cancel.',
  },
};

export function t(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  let s = BUILDER_STRINGS[lang]?.[key] ?? BUILDER_STRINGS.fa[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
