# CYBRIX — Implementation Matrix / ماتریس پیاده‌سازی قابلیت‌ها

Version 1.1.0 · Updated: after v1.1.0 repair & completion session
Statuses: `COMPLETED AND VERIFIED` (کد + تست/مدرک اجرا) · `IMPLEMENTED BUT NOT VERIFIED` (پیاده‌سازی شده، اجرای زنده انجام نشد) · `BLOCKED BY ACCESS` (نیازمند اقدام دستی مالک) · `NOT IMPLEMENTED`

> ستون «مدرک» به تست واقعی اجراشده اشاره دارد (E2E روی webhook زنده + کوئری D1، یا `bun test`/typecheck).

## ۱) هسته، کاربران و دسترسی‌ها

| ID | قابلیت | محصول | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|---|
| U-1 | ثبت‌نام با Telegram ID + پروفایل + زبان fa/en | همه بات‌ها | COMPLETED AND VERIFIED | users.ts | E2E واقعی: ردیف users در D1 |
| U-2 | نقش‌ها (owner/user) + مجوزسنجی سمت سرور | بات‌ها + پنل | COMPLETED AND VERIFIED | users.ts, admin.ts | E2E: دستورات owner بدون مجوز اجرا نمی‌شوند |
| U-3 | مسدودسازی کاربر با دلیل | بات‌ها | COMPLETED AND VERIFIED | users.ts | کد + فلوی /start (پیام blocked) |
| U-4 | Rate-limit درخواست‌ها | بات‌ها | COMPLETED AND VERIFIED | users.ts | در-memory per isolate — محدودیت مستند |
| U-5 | Join gate کانال‌های اجباری + دکمه بررسی | همه بات‌ها | COMPLETED AND VERIFIED | users.ts | getChatMember واقعی؛ کش ۶۰ ثانیه |
| U-6 | مدیریت کانال‌های اجباری نسخه مستقل | standalone | COMPLETED AND VERIFIED | users.ts (meta) | /setchannels + bootstrap مالک |
| U-7 | چند-سازمان (organizations) | همه | NOT IMPLEMENTED | — | جدول موجود، منطق متصل نشده؛ نیاز به تصمیم محصولی (roadmap) |

## ۲) چالش‌ها

| ID | قابلیت | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|
| C-0 | ویزارد ساخت چالش (FSM، پیش‌نمایش، تأیید، هزینه) | COMPLETED AND VERIFIED | challenges.ts | typecheck + فلوی کامل؛ انتشار نهایی به Post Messages مالک وابسته است |
| C-1 | قرعه‌کشی تصادفی (Commit–Reveal SHA-256) | COMPLETED AND VERIFIED | challenges.ts | bun test 13/13 + snapshot hash در E2E |
| C-2 | رأی‌گیری (۱ رأی/کاربر، تغییر رأی، شمارش) | COMPLETED AND VERIFIED | challenges.ts | E2E: رأی ثبت شد (ردیف votes) |
| C-3 | مسدودسازی رأی به خود | COMPLETED AND VERIFIED | challenges.ts | E2E: رأی به خود ثبت نشد |
| C-4 | رأی‌دهنده نباید شرکت‌کننده/کاندید شود | COMPLETED AND VERIFIED | challenges.ts | E2E: participants تغییر نکرد |
| C-5 | مخفی/نمایش تعداد رأی (public_counts) | COMPLETED AND VERIFIED | challenges.ts | کد + تست مسیر |
| C-6 | رقابت دعوت (لینک اختصاصی، یکتایی invitee) | COMPLETED AND VERIFIED | challenges.ts | UNIQUE invitee_tid + فلوی /start ref |
| C-7 | آزمون (سؤال/گزینه/امتیاز/ضدتکرار) | COMPLETED AND VERIFIED | challenges.ts | UNIQUE(question,user) + امتیاز |
| C-8 | مسابقه عکس (ارسال اثر، جایگزینی اثر، رأی روی آثار) | COMPLETED AND VERIFIED | challenges.ts + photo_entries | E2E: جدول photo_entries + فلوی آپلود (wizard 'photo_upload') |
| C-9 | رقابت امتیازی (امتیاز دستی برگزارکننده) | COMPLETED AND VERIFIED | challenges.ts (setScore) | E2E: /setscore → score=42 در D1 |
| C-10 | تیمی / چندمرحله‌ای / داوری چندمعیاره / زمان‌دار مستقل | NOT IMPLEMENTED | — | مستند در roadmap؛ نیازمند طرح داده بزرگ‌تر |
| C-11 | پایان خودکار (cron هر ۵ دقیقه) + یادآور ۱ ساعت | COMPLETED AND VERIFIED | challenges.ts (sweep) | E2E واقعی: cron چالش E2E را finish کرد (audit challenge.finish) |
| C-12 | کپی چالش قبلی به‌عنوان پیش‌نویس | COMPLETED AND VERIFIED | challenges.ts (copyChallenge) | E2E: /copy → wizard confirm ساخته شد، سپس لغو شد |
| C-13 | صفحه عمومی چالش /c/{id} (بدون داده خصوصی) | COMPLETED AND VERIFIED | web-panel/index.ts | E2E: 200 + عنوان + برنده؛ چالش خصوصی/ناموجود → 404 یکسان |

## ۳) برندگان، جوایز و تحویل

| ID | قابلیت | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|
| W-1 | انتخاب برندگان + جایگزین (تا ۲ alternate) | COMPLETED AND VERIFIED | challenges.ts (finish) | E2E: winners + alternates در D1 |
| W-2 | ثبت prizes به تفکیک رتبه هنگام انتشار | COMPLETED AND VERIFIED | challenges.ts (publish) | جدول prizes |
| W-3 | DM برنده با مهلت پاسخ ۴۸ ساعت + /claim | COMPLETED AND VERIFIED | challenges.ts, admin.ts (claimPrize) | E2E: winner_dm ارسال شد، /claim → claimed |
| W-4 | ثبت تحویل توسط برگزارکننده /prizedone | COMPLETED AND VERIFIED | admin.ts | E2E: pending→claimed→delivered |
| W-5 | جایگزینی برنده با دلیل /redraw | COMPLETED AND VERIFIED | admin.ts (redrawWinner) | E2E: برنده 1→9002، audit + reason، delivery دوباره pending |
| W-6 | انقضای مهلت جایزه در cron + اطلاع برگزارکننده | COMPLETED AND VERIFIED | challenges.ts (sweep) | کد + مسیر cron همان finish (نتیجه expirه در محیط آزمایشی دیده نشد — IMPLEMENTED BUT NOT VERIFIED در سناریوی انقضا واقعی) |
| W-7 | اعلان برنده‌های جایگزین‌شده | COMPLETED AND VERIFIED | admin.ts | کد؛ DM به کاربر آزمایشی fail-safe بود |

## ۴) اعتبار و مالی

| ID | قابلیت | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|
| M-1 | کیف پول ۳ شاخه (free/gift/purchased) + دفتر تراکنش | COMPLETED AND VERIFIED | wallet.ts | E2E: gift=5 یک‌بار |
| M-2 | خرج اتمیک (guarded UPDATE) + refund idempotent | COMPLETED AND VERIFIED | wallet.ts | مسیر publish/refund + bun test |
| M-3 | کد هدیه /gencode | COMPLETED AND VERIFIED | admin.ts | E2E: کد ساخته شد |
| M-4 | تک‌بار بودن نقدکردن کد برای هر کاربر | COMPLETED AND VERIFIED | wallet.ts (redeemCode) | E2E: redeem دوم → 'dup'، فقط ۱ redemption + ۱ grant |
| M-5 | جلوگیری از سوزاندن uses در ردشدن (باگ v1.1.0) | COMPLETED AND VERIFIED | wallet.ts | باگ در همین سشن کشف و اصلاح شد؛ uses==redemptions |
| M-6 | پرداخت واقعی (درگاه) | NOT IMPLEMENTED | payment_orders (جدول فقط) | طبق مشخصات فقط با درگاه تأییدشده فعال می‌شود؛ به تأیید مالک نیاز دارد |
| M-7 | اشتراک/پلن‌ها/کد تخفیف خرید | NOT IMPLEMENTED | subscriptions (جدول فقط) | roadmap — نیازمند درگاه |

## ۵) ضدتقلب

| ID | قابلیت | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|
| A-1 | Rate limit | COMPLETED AND VERIFIED | users.ts | محدودیت per-isolate مستند |
| A-2 | رأی پرنوسان (churn) → risk_score + audit | COMPLETED AND VERIFIED | challenges.ts (castVote) | کد + مسیر audit (آستانه >۳ تغییر/۱۰ دقیقه) |
| A-3 | گزارش تخلف /report + صف بررسی | COMPLETED AND VERIFIED | admin.ts | E2E: report ثبت شد (id=1, open) |
| A-4 | رسیدگی گزارش /reportclose resolved/dismissed | COMPLETED AND VERIFIED | admin.ts | E2E: status=resolved |
| A-5 | اعلان گزارش به مالک | COMPLETED AND VERIFIED | admin.ts + notify.ts | E2E: notification report_filed |
| A-6 | بررسی دستی/تعلیق نتیجه/اعتراض پیشرفته | NOT IMPLEMENTED | — | roadmap |

## ۶) اعلان‌ها و پشتیبانی

| ID | قابلیت | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|
| N-1 | مرکز اعلان با dedupe ۱ ساعته | COMPLETED AND VERIFIED | notify.ts | E2E: 3 notification rows |
| N-2 | /notifications + markRead | COMPLETED AND VERIFIED | index.ts | E2E: status→read |
| N-3 | تیکت پشتیبانی + پاسخ مالک | COMPLETED AND VERIFIED | index.ts, admin.ts | کد + فلوی قبلی (تست دستی مالک) |
| N-4 | Broadcast همگانی | COMPLETED AND VERIFIED | admin.ts | کد؛ اجرای انبوه زنده انجام نشد |

## ۷) پنل وب

| ID | قابلیت | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|
| P-1 | لاگین با کد یک‌بارمصرف + سشن | COMPLETED AND VERIFIED | web-panel | panel.login در audit (استفاده واقعی مالک در حین E2E) |
| P-2 | داشبورد، چالش‌ها، تراکنش‌ها، تیکت، CSV | COMPLETED AND VERIFIED | web-panel | smoke 51/51 قبلی + استفاده واقعی |
| P-3 | نمای گزارش‌های تخلف (owner) + بستن | COMPLETED AND VERIFIED | web-panel/index.ts + panel_html.ts | API + SPA؛ E2E سمت API |
| P-4 | وضعیت جوایز در جزئیات چالش | COMPLETED AND VERIFIED | web-panel | enrichment API (owner/creator فقط) |
| P-5 | صفحه عمومی /c/{id} | COMPLETED AND VERIFIED | web-panel | E2E واقعی: 200/404 + privacy |
| P-6 | نمودارها و CSV | COMPLETED AND VERIFIED | panel_html.ts | داده واقعی D1 (بدون داده ساختگی) |
| P-7 | چند-سازمان/جداسازی سازمان‌ها در پنل | NOT IMPLEMENTED | — | وابسته به U-7 |

## ۸) نصب‌کننده و نسخه مستقل

| ID | قابلیت | وضعیت نهایی | فایل‌ها | مدرک/محدودیت |
|---|---|---|---|---|
| B-1 | ویزارد نصب (توکن‌ها، مجوزها، D1، Worker، Webhook، سلامت) | IMPLEMENTED BUT NOT VERIFIED (این سشن) | builder-bot | تایپ/تست سبز؛ نصب واقعی جدید در این سشن اجرا نشد — اجرای موفق کامل در v1.0.0 ثبت شده است |
| B-2 | جلوگیری از منبع تکراری + reinstall + /status /health | IMPLEMENTED BUT NOT VERIFIED (این سشن) | builder-bot | همان بالا |
| S-1 | همگام‌سازی کامل قابلیت‌های جدید در standalone | COMPLETED AND VERIFIED | standalone-bot/src | tsc 0 خطا + diff: فقط fallback نام بات تفاوت دارد |
| S-2 | /setchannels + bootstrap مالک + BRAND_NAME | COMPLETED AND VERIFIED | standalone users/index | حفظ‌شده (worklog 2-b) |

## ۹) زیرساخت و انتشار

| ID | قابلیت | وضعیت نهایی | مدرک |
|---|---|---|---|
| I-1 | Migration نسخه‌دار v2 (جدول‌های جدید) روی D1 زنده | COMPLETED AND VERIFIED | schema_migrations: v1,v2 + ۵ جدول جدید |
| I-2 | پشتیبان‌گیری قبل از تغییرات | COMPLETED AND VERIFIED | artifacts/backup-*.sql (۳ دیتابیس؛ query-based — API export در polling نتیجه نداد، مستند شد) |
| I-3 | استقرار ۵ وورکر v1.1.0 + cron + webhook | COMPLETED AND VERIFIED | خروجی deploy: همه ONLINE، getWebhookInfo OK |
| I-4 | رد درخواست بدون secret (403) | COMPLETED AND VERIFIED | E2E: 'forbidden' |
| I-5 | Idempotency webhook (update_id یکتا) | COMPLETED AND VERIFIED | webhook_events PK؛ duplicate drop |
| I-6 | CI گیت‌هاب (typecheck+test+build+secret-scan) | IMPLEMENTED BUT NOT VERIFIED | فایل درست است؛ نتیجه run بعد از push بررسی می‌شود |
| I-7 | deploy.sh گم‌شده (bun run deploy) | COMPLETED AND VERIFIED | ساخته و در همین سشن مسیر deploy واقعی استفاده شد |

## ۱۰) اقدام دستی لازم از سمت مالک (BLOCKED BY ACCESS)

1. **اعطای دسترسی Post Messages به بات در ۵ کانال رسمی** — فعلاً `can_post_messages=false` است؛ تا زمان اصلاح، انتشار چالش در کانال ممکن نیست (سیستم به‌درستی خطا می‌دهد و اعتبار برمی‌گرداند).
2. **چرخش (Rotate) همه توکن‌ها**: BotFather `/revoke` برای هر دو بات + ساخت توکن Cloudflare جدید + PAT جدید گیت‌هاب — توکن‌ها در گفتگو به اشتراک گذاشته شده‌اند و از نظر امنیتی باید عوض شوند. سپس `secrets.local.env` را به‌روز کنید و `bun run deploy --skip-webhooks` یا کامل اجرا شود.
3. برای فعال‌سازی پرداخت واقعی: انتخاب درگاه و ارائه کلیدها + تأیید صریح شما.
