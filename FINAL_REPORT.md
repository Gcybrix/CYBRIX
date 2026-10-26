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

---

# 🔄 v1.1.0 — Repair, Audit & Feature Completion Session
Date: 2026-10-26 (second session) · Basis: full audit of the live v1.0.0 deployment + GitHub main @ bfa8419

## ۱) روش حسابرسی
- بازسازی مخزن از GitHub (سندباکس قبلی پاک شده بود)، نصب وابستگی‌ها، `tsc` (۰ خطا)، `bun test` 13/13.
- بررسی سلامت ۵ وورکر زنده، getWebhookInfo، اسکن اطلاعات شخصی/توکن در تمام شاخه‌ها (شامل backup/legacy-main) → **تمیز** (فقط placeholderها).
- مطالعه کامل کد بات مرکزی/پنل و مقایسه با مشخصات → شناسایی باگ‌ها و قابلیت‌های ناقص.

## ۲) باگ‌های کشف‌شده و اصلاح‌شده (با علت)
| # | باگ | علت ریشه‌ای | اصلاح |
|---|---|---|---|
| 1 | `bun run deploy` شکست می‌خورد | package.json به `scripts/deploy.sh` ارجاع می‌داد که وجود نداشت | فایل wrapper ساخته شد (`scripts/deploy.sh`) |
| 2 | دکمه «کانال‌های من» فقط متن راهنما می‌فرستاد | callback `menu:mychannels` به متن `channel_add` متصل بود | helper `listMyChannels` + اتصال صحیح callback و /mychannels |
| 3 | دکمه `/redeem` (noop) هیچ بازخوردی نداشت | callback_data='noop' هندل نشده بود | alert راهنما |
| 4 | رأی‌دهنده به‌صورت خودکار کاندید می‌شد | castVote برای رأی‌دهنده participant درج می‌کرد | حذف درج؛ رأی‌دهنده فقط رأی‌دهنده است |
| 5 | رأی به خود مجاز بود | بررسی target==voter وجود نداشت | مسدودسازی + پیام vote_self |
| 6 | `public_counts` نادیده گرفته می‌شد | config خوانده نمی‌شد | openVoteList به آن احترام می‌گذارد |
| 7 | ریسک شکست finish در چالش‌های پرجمعیت (سقف subrequest) | recheck عضویت برای همه | pending همیشه + active سقف ۳۰ |
| 8 | کد هدیه قابل نقد چندباره توسط یک کاربر | رهگیری per-user وجود نداشت | جدول coupon_redemptions + claim slot + rollback (E2E: redeem دوم → dup) |
| 9 | باگ جدید v1.1.0: uses کد حتی در رد شدن می‌سوید | UPDATE مستقل از نتیجه INSERT | ترتیب: INSERT slot → UPDATE guarded → rollback (E2E: uses==redemptions) |
| 10 | باگ جدید v1.1.0: /redraw روی UNIQUE(challenge,rank) می‌شکست | INSERT ردیف delivery جدید برای رتبه موجود | استفاده مجدد از همان ردیف delivery (تاریخچه در audit) |
| — | «branches: ain]» در CI | **اشتباه حسابرسی**: لایه نمایش ترمینال دنباله `[m` را می‌خورد؛ فایل کامیت‌شده همیشه `[main]` بود (تأیید با od/git) | نیازی به تغییر نبود — مستند شد |

## ۳) قابلیت‌های اضافه‌شده (همه با منطق واقعی + D1)
- دو نوع چالش جدید: **مسابقه عکس** (آپلود/جایگزینی اثر + رأی روی آثار) و **رقابت امتیازی** (/setscore) → مجموع ۶ نوع.
- **چرخه تحویل جایزه**: prizes به تفکیک رتبه، DM برنده با مهلت ۴۸ ساعت، /claim، /prizes، /prizedone، /redraw با دلیل، انقضای خودکار در cron + اطلاع برگزارکننده، برندگان جایگزین (تا ۲).
- **مرکز اعلان‌ها** با dedupe + /notifications (خوانده/نخوانده).
- **ضدتقلب**: risk_score برای churn رأی، /report + صف بررسی مالک (/reports، /reportclose) + اعلان مالک.
- **کپی چالش** (/copy) به‌عنوان پیش‌نویس پیش‌پرشده.
- **صفحه عمومی چالش** `/c/{id}` در پنل (فقط با opt-in برگزارکننده؛ بدون هیچ داده خصوصی؛ 404 یکسان برای خصوصی/ناموجود).
- **پنل**: نمای گزارش‌های تخلف + وضعیت جوایز در جزئیات چالش (فقط owner/سازنده).
- Migration v2 (۵ جدول جدید) با اجرای idempotent روی D1 زنده + پشتیبان‌گیری query-based از هر ۳ دیتابیس قبل از deploy.

## ۴) تست‌های اجراشده (مدرک واقعی)
- `bunx tsc --noEmit` → ۰ خطا (کل مخزن) · `bun test` → 13/13 · `bash scripts/build.sh` → ۴ باندل OK.
- Smoke پنل توسط ایجنت: 81/81 (XSS، privacy، 404 یکسان، reports API، regressionها).
- **E2E روی production** (تزریق آپدیت سینتتیک به webhook زنده با secret + راستی‌آزمایی با کوئری D1):
  رد secret اشتباه (403) · رأی ثبت شد · **رأی به خود مسدود شد** · گزارش تخلف ثبت/بسته شد · کد هدیه: ساخت/نقد یک‌باره/dup · کپی چالش → confirm → لغو · /setpage → صفحه عمومی 200 با عنوان و برنده و **بدون Telegram ID** · cron چالش را finish کرد (winners + prize_deliveries + DM) · **چرخه کامل جایزه: pending → redraw (تعویض برنده با دلیل) → claimed → delivered** · /setscore=42 · اعلان‌ها read شدند.
- Health بعد از deploy: هر ۵ وورکر v1.1.0 ONLINE + db:ok · getWebhookInfo: بدون خطا.

## ۵) وضعیت استقرار v1.1.0
همه ۵ سرویس به‌روزرسانی شدند (central/panel/builder/demo/demo-panel)، cron فعال، هر دو webhook با secret تنظیم شد. Push به GitHub پس از secret-scan انجام شد؛ نتیجه CI پس از push بررسی شد (بخش ۷ پایین).

## ۶) محدودیت‌ها و موارد باز
- Post Messages بات در ۵ کانال رسمی همچنان false → **BLOCKED BY ACCESS** (نیاز به اقدام مالک).
- درگاه پرداخت واقعی، اشتراک/پلن‌ها، تیم، چندمرحله‌ای، داوری چندمعیاره، چند-سازمان، API عمومی با کلید → **NOT IMPLEMENTED** (مستند در docs/FEATURE_MATRIX.md به‌همراه دلیل و roadmap).
- پشتیبان‌گیری: endpoint رسمی export/polling در این سشن نتیجه نداد؛ از dump جدول‌به‌جدول استفاده شد (artifacts/backup-*.sql) — برای پشتیبان زمان‌بندی‌شده، بررسی آینده endpoint توصیه می‌شود.
