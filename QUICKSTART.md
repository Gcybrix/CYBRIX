# 🚀 CYBRIX — Quickstart

## 1) پیش‌نیازها / Prerequisites
- Node 18+ یا **Bun 1.1+** (پیشنهادی)
- یک حساب Cloudflare رایگان
- یک بات تلگرام از [@BotFather](https://t.me/BotFather)

## 2) دریافت کد / Get the code
```bash
git clone https://github.com/Gcybrix/CYBRIX.git
cd CYBRIX
bun install          # یا: npm install
bun test             # تست‌های هسته → 13/13 ✔
```

## 3) تنظیم Secretها / Configure secrets
```bash
cp .env.example secrets.local.env
```
مقادیر را پر کنید (**هرگز این فایل را commit نکنید** — در .gitignore است):

| متغیر | توضیح |
|---|---|
| `CF_TOKEN` | توکن API کلادفلر با دسترسی: Workers Scripts Edit + D1 Edit |
| `CF_ACCOUNT_ID` | شناسه حساب کلادفلر |
| `CENTRAL_BOT_TOKEN` | توکن بات مرکزی از BotFather |
| `BUILDER_BOT_TOKEN` | توکن بات نصب‌کننده از BotFather |
| `OWNER_TG_ID` | آی‌دی عددی مالک (از @userinfobot) |
| `MANDATORY_CHANNELS` | JSON آرایه کانال‌های اجباری، مثال: `["@mychannel"]` |

## 4) بیلد و استقرار / Build & deploy
```bash
bash scripts/build.sh     # باندل ۴ ورکر با esbuild
bun scripts/deploy.ts     # ساخت D1 + آپلود ورکرها + Secrets + Cron + Webhook
```
خروجی موفق → همه سرویس‌ها `ONLINE`:
- `https://cybrix-central-bot.<subdomain>.workers.dev`
- `https://cybrix-web-panel.<subdomain>.workers.dev`
- `https://cybrix-builder-bot.<subdomain>.workers.dev`

> اسکریپت deploy با چند فرمت API کلادفلر تلاش می‌کند و اگر کرون ست نشد، پایان چالش‌ها به‌صورت lazy (در هر آپدیت) هم بررسی می‌شود.

## 5) تنظیمات تلگرام (دستی) / Telegram side (manual)
1. بات مرکزی را در کانال(های) مقصد **ادمین** کنید و حتماً دسترسی **Post Messages** فعال باشد.
   (بدون این دسترسی، ثبت کانال با پیام راهنما رد می‌شود — رفتار صحیح سیستم)
2. در بات `/start` بزنید و کانال‌های اجباری را عضو شوید.
3. `/mychannels` → دکمه «افزودن کانال» → @username کانال را بفرستید.
4. `/create` → ویزارد ۶ مرحله‌ای چالش.
5. `/panel` → کد ورود ۵ دقیقه‌ای پنل وب را دریافت کنید.

## 6) نصب نسخه اختصاصی (بات نصب‌کننده)
1. به [@Likecybrix_bot](https://t.me/Likecybrix_bot) بروید و `/install` بزنید.
2. توکن بات اختصاصی‌تان را بفرستید (از BotFather).
3. توکن Cloudflare خود را بفرستید (حداقل: Workers Scripts Edit + D1 Edit + Accounts Read).
4. نام منابع را تأیید کنید → تایید نهایی → مراحل به‌صورت زنده ✅/❌ نمایش داده می‌شود.
5. بعد از نصب: توکن‌ها از دیتابیس نصب‌کننده **پاک می‌شوند**؛ به‌هرحال چرخش (rotate) توکن‌ها توصیه می‌شود.

## 7) تست سلامت / Health
```bash
curl https://cybrix-central-bot.<subdomain>.workers.dev/health
# {"ok":true,"service":"cybrix-central-bot","version":"1.0.0","db":"ok"}
```

## عیب‌یابی سریع / Troubleshooting
| نشانه | علت رایج | راه‌حل |
|---|---|---|
| `publish_channel_fail` | بات دسترسی Post Messages ندارد | ادمین کردن بات با اجازه ارسال پیام |
| کد پنل کار نمی‌کند | ۵ دقیقه گذشته یا قبلاً استفاده شده | دوباره `/panel` |
| webhook 403 | secret نامنظیم | setWebhook را دوباره اجرا کنید |
| `not enough credits` | هزینه چالش > موجودی | `/wallet` → کد هدیه یا grant مالک |

## 5) Deploy سریع (v1.1.0+)
```bash
bash scripts/build.sh          # بیلد ۴ ورکر
bun run deploy                 # = scripts/deploy.sh → deploy.ts (D1 + Workers + Secrets + Cron + Webhook + Health)
bun run deploy --skip-webhooks # به‌روزرسانی کد بدون تغییر webhook
```
پس از موفقیت، `artifacts/deploy-summary.json` تولید می‌شود و secretهای webhook در `secrets.local.env` (gitignored) ذخیره می‌شوند.

## 6) دستورات جدید بات (v1.1.0)
- کاربران: `/notifications` `/report <chid> <reason>` `/claim <chid>`
- برگزارکننده: `/copy <chid>` `/setpage <chid> on|off` `/setscore <chid> <tid> <score>` `/prizes <chid>` `/prizedone <chid> <rank>` `/redraw <chid> <rank> <reason>`
- مالک: `/reports` `/reportclose <id> <resolved|dismissed>`
- انواع چالش: random · vote · referral · quiz · **photo** · **points**
- صفحه عمومی چالش: `https://<panel>/c/<id>` (بعد از `/setpage <id> on`)
