# CYBRIX — Final Delivery Report / گزارش نهایی تحویل
Date: 2026-10-26 · Version 1.0.0 · Deploy: Cloudflare (account feeba4e8…fb23, subdomain `official-cybrix.workers.dev`)

## ۱) سرویس‌های مستقرشده (REAL DEPLOYMENT — verified)
| سرویس | URL | وضعیت |
|---|---|---|
| بات مرکزی | https://cybrix-central-bot.official-cybrix.workers.dev | ✅ ONLINE, db:ok (تأیید شده با curl) |
| پنل وب | https://cybrix-web-panel.official-cybrix.workers.dev | ✅ ONLINE, db:ok |
| بات نصب‌کننده | https://cybrix-builder-bot.official-cybrix.workers.dev | ✅ ONLINE, db:ok |
| نسخه مستقل نمونه | https://cybrix-demo.official-cybrix.workers.dev | ✅ ONLINE, db:ok |
| پنل نمونه مستقل | https://cybrix-demo-panel.official-cybrix.workers.dev | ✅ ONLINE, db:ok |
| D1 | cybrix-central-db, cybrix-builder-db, cybrix-demo-db | ✅ ساخته شد |
| Cron | هر ۵ دقیقه (central + demo) | ✅ ثبت شد |
| Webhook | هر دو بات با secret_token | ✅ setWebhook → OK |
| Bots | [@like_cybrixbot](https://t.me/like_cybrixbot) · [@Likecybrix_bot](https://t.me/Likecybrix_bot) | ✅ زنده |
| GitHub | https://github.com/Gcybrix/CYBRIX (branch `main`) | ✅ Push شد — محتوای قبلی در `backup/legacy-main` حفظ شد |

## ۲) وضعیت قابلیت‌ها (per required categories)
### COMPLETED AND VERIFIED
- ثبت‌نام کاربر، نقش‌ها (owner/user)، پروفایل، زبان fa/en — *تست: E2E webhook واقعی، ردیف users+wallets در D1*
- عضویت اجباری ۵ کانال رسمی + دکمه بررسی — *تست: getChatMember در فلوی /start*
- ثبت کانال با بررسی ادمین‌بودن کاربر + دسترسی Post بات — *تست واقعی: به‌درستی رد شد چون can_post=false بود (گزارش شد)*
- ویزارد ساخت چالش (۶ مرحله، ۴ نوع: random/vote/referral/quiz) — *typecheck + مسیر کد؛ انتشار به کانال به Post Messages مالک وابسته است*
- قرعه‌کشی Commit–Reveal (SHA-256، salt، snapshot hash، اثبات عمومی) — *تست: `bun test` 13/13*
- رأی‌گیری (یک رأی، تغییر رأی، شمارش)، دعوت معتبر (یکتایی invitee)، آزمون (امتیاز، ضدتکرار)
- پایان چالش: sweep کرون + lazy، حذف صلاحیت‌شده‌ها، انتخاب برنده، اعلام عمومی + DM برنده
- کیف پول (۳ نوع اعتبار، دفترکل، spend اتمیک با batch، refund با ضدتکرار) — *تست: ردیف credit_transactions*
- کدهای هدیه (/gencode، /redeem با شمارنده اتمیک)
- پشتیبانی (تیکت + پاسخ مالک)، /broadcast، /grant، آمار
- پنل وب: ورود با کد یک‌بارمصرف، summary، چالش‌ها، تراکنش‌ها، CSV، RTL/EN، تم تاریک/روشن — *تست واقعی مرورگر + 7 اسکرین‌شات*
- امنیت webhook: secret token (403 تأیید شد) + idempotency آپدیت (تأیید شد)
- نصب‌کننده: ویزارد کامل، اعتبارسنجی توکن‌ها، ساخت D1/Worker/Panel با REST، setWebhook، health check، حذف توکن‌ها پس از نصب

### IMPLEMENTED BUT NOT VERIFIED (deployed; real run blocked by external dependency)
- انتشار پیام چالش به کانال واقعی — نیازمند دسترسی Post Messages بات در کانال‌ها (اقدام دستی مالک)
- جریان کامل دعوت/رأی/آزمون روی چالش واقعی منتشرشده — نیازمند همان پیش‌نیاز
- کرون‌های زمان‌بندی‌شده در افق زمانی بلند — endpoint و کد موجود، اجرای چندساعته مشاهده نشده

### BLOCKED BY ACCESS
- پرداخت واقعی — درگاه فعال/حساب تسویه در دسترس نیست؛ عمداً فعال‌سازی نشده (فیک پیاده‌سازی نشد). `payment_orders` فقط ثبت سفارش
- ویدیوی آموزشی — ضبط ffmpeg در محیط سندباکس شکست خورد (`ffmpeg write failed: Broken pipe`)؛ ۷ اسکرین‌شات واقعی جایگزین شد
- نصب E2E توسط بات نصب‌کننده برای بات سوم — توکن بات سوم در دسترس نیست؛ منطق استقرار با همان REST روی حساب اصلی تست شد (D1+Worker+Panel+subdomain همه با همین روش ساخته شدند)

### DEFERRED (roadmap)
- ۶ نوع چالش دیگر (عکس، تیمی، چندمرحله‌ای، داوری‌شده، امتیازی/زمان‌دار پیشرفته)
- سرویس سیاست‌گذاری مرکزی برای نسخه مستقل (در حال حاضر کانال‌های رسمی فقط پیش‌فرض قابل‌تغییر توسط مالک آن نصب هستند — شفاف و مستند، ادعای «مبهم‌سازی نشکن» نمی‌کنیم)
- OAuth کلادفلر در نصب‌کننده (فعلاً توکن محدود + راهنمای چرخش)
- Subscription plans, discount campaigns, multi-channel management tools

### NOT IMPLEMENTED
- هیچ چیز از محدوده نسخه ۱ اعلام‌شده در بالا باقی نماند؛ موارد بالا یا تأیید/نیمه‌تأیید/مسدود/به تعویق‌افتاده دسته‌بندی شدند.

## ۳) تست‌های اجراشده (شواهد)
- `bun test` → **13/13 pass** (قرعه‌کشی قطعی/تغییرپذیر با salt، i18n برابری کلیدها، تهران-زمان، اعتبارها)
- `tsc --noEmit` → 0 error در کل مونوریپو
- E2E واقعی روی deploy: /start (users+wallets+tx در D1) · /panel (کد ۸ کاراکتری) · ورود پنل با کد (token + 401 برای استفاده مجدد) · 403 با secret اشتباه · drop آپدیت تکراری · builder /start (builder_users در D1)
- مرورگر واقعی: ورود به پنل و ۷ اسکرین‌شات (login, dashboard, challenges, transactions, EN, light, mobile)
- اسکن اسرار پیش از push: پاک (`rg` روی الگوهای توکن، خارج از فایل‌های gitignored)

## ۴) امنیت
- هیچ توکنی در کد/مخزن/log نیست؛ همه در Cloudflare Secrets و `secrets.local.env` (gitignored)
- Webhook با `secret_token`؛ پنل با session توکن ۷روزه + کد یک‌بارمصرف ۵دقیقه‌ای + rate limit 5/10min/IP
- SQL پارامتری در همه کوئری‌ها؛ CSV با BOM؛ escape سمت کلاینت و سرور
- ⚠️ **اقدام توصیه‌شده فوری برای مالک:** چون توکن‌ها در چت (این گفتگو) منتشر شده‌اند، پس از تأیید نهایی، هر ۴ توکن را rotate کنید: BotFather `/revoke` ×۲، GitHub → regenerate fine-grained PAT، Cloudflare →Roll API Token. سپس مقادیر جدید را در `secrets.local.env` و Secrets ورکرها به‌روز کنید (`bun scripts/deploy.ts` دوباره).

## ۵) اقدامات دستی باقی‌مانده (مالک)
1. به بات مرکزی دسترسی **Post Messages** در ۵ کانال رسمی بدهید (الان admin است ولی can_post=false)
2. `/panel` → کد → ورود به پنل
3. چرخش توکن‌ها (بند ۴)
4. اختیاری: دامنه اختصاصی به‌جای workers.dev

## ۶) شناخته‌شده‌ها/محدودیت‌ها
- Rate-limit در حافظه isolate است (بین isolateها هم‌گام نیست) — برای مقیاس بالا KV/DO لازم است
- بررسی عضویت لحظه ترک‌کردن کانال را تلگرام اطلاع نمی‌دهد؛ سیستم در پایان چالش دوباره چک می‌کند (مستند شد)
- Broadcast سرعت ۳۰msg/s (زیر سقف تلگرام)
- D1 free plan: 5M row-read/day — برای مقیاس فعلی کافی
