# RAS-EGX-ASTRA-V5

نسخة تطوير منفصلة من ASTRA V4 (الأصل لم يُعدَّل). تحتفظ بكامل بنية V4 (تسليم ذري، حوكمة، سجل ترقية، فحوص إنتاج)
وتضيف **مساراً كمّياً مُختبَراً (Quant Lane)** بصفة بحثية/ظل.

- التقييم والخطة وما أُنجز وما لم يُنجز: [`docs/V5-EVALUATION-AND-PLAN.md`](docs/V5-EVALUATION-AND-PLAN.md)
- المحرك الكمّي: [`quant/`](quant/) — Python (`pandas`, `scikit-learn`)
- المحوّل واللوحة: `engine/ucp/quant-adapter.js`, `app/api/quant.js`, `app/dashboard/command-center.html`
- الحمولة المنشورة: `data/quant/signals.json` (schema `astra-quant/v1`)

## رابط يتحدث وحده بعد كل جلسة (مرة واحدة فقط)
السلسلة تعمل بلا تدخل: مستودعك العام `RAS-EGX-PRO2026-NEXT` ← تحديث ASTRA الذري ← محرك الكم ← بناء الصفحة ← **GitHub Pages**.
لا أسرار مطلوبة (المصدر `raw.githubusercontent.com` العام).
1. ثبّت **GitHub Desktop**، ثم *File ▸ Add local repository* واختر مجلد `ASTRA-V5` (إن سأل أنشئ مستودعاً)، ثم **Publish repository** (يقبل أي عدد ملفات، بخلاف الرفع من المتصفح الذي يحدّ بـ100 ملف).
2. على github.com: *Settings ▸ Pages ▸ Source: GitHub Actions*.
3. *Actions* ▸ فعّل الـworkflows ▸ شغّل **Daily EGX Data Refresh** ثم **ASTRA Quant Lane (daily)** يدوياً مرة واحدة (Run workflow).
4. رابطك الدائم: `https://اسم-المستخدم.github.io/اسم-المستودع/` — افتحه من الموبايل واختر *إضافة إلى الشاشة الرئيسية*.
بعدها يعمل تلقائياً الأحد–الخميس بعد الإغلاق، ولا يُحدّث الملفات إلا عند تغيّر حقيقي في البيانات.

## التشغيل على جهازك (Node 20+ و Python 3.9+)
```bash
npm run quant:setup     # مرة واحدة: pandas / numpy / scikit-learn
npm start               # لوحة القيادة على http://localhost:3000  (تشغّل /api/* محلياً)
npm test && npm run quant:test
npm run quant:update    # جسر ← تحديث ← محرك ← نشر (اسم Python يُكتشف تلقائياً)
```
**مهم:** لا تفتح `command-center.html` بالنقر المزدوج؛ تحتاج اللوحة خادم `/api` (`npm start` أو Vercel).

أداة دعم قرار وليست نصيحة استثمارية. التنفيذ الآلي معطّل دائماً.


## ملاحظات النشر الفعلي — 2026-10-04
- المستودع: https://github.com/rasheadsca-star/astra-v5-egx ، الفرع الافتراضي `main`.
- يستخدم `quant-daily.yml` النشر المباشر عبر `upload-pages-artifact` و`deploy-pages` من `docs/` بعد نجاح المسار الكمّي. هذا يتجنب الاعتماد على تشغيل بناء Pages نتيجة push بواسطة `GITHUB_TOKEN`؛ لا PAT مطلوب.
- يلزم اختيار **Settings → Pages → Source → GitHub Actions** مرة واحدة. قبل ذلك يصدر تحذير صريح `PAGES_SETUP_REQUIRED` وتُتخطّى خطوة النشر؛ نجاح الاختبارات وحده لا يعني نجاح Pages.
- `ASTRA Deployment Acceptance` يشغّل `workflow_dispatch` فعلياً بالترتيب: التحديث ثم المسار الكمّي ثم إعادة المسار، ويتحقق من ثبات commit بين التشغيلين الأخيرين. لا يضيف أسعاراً أو يجبر التحديث.
- المصدر العام هو القيمة الافتراضية لـ`ASTRA_CANONICAL_SOURCE_BASE`؛ يمكن تخصيصه بمتغير مستودع بالاسم نفسه.
- ملفات فحص الإنتاج والسجل الأمامي الموروثة كانت تشير إلى تطبيق V4 وتقارن commit الخاص به بـV5، وهذا ليس اختباراً صالحاً لنشر V5. فحص الإنتاج الخارجي وجمع UCP الأمامي يتطلبان الآن متغير `ASTRA_V5_PROD_URL` لخادم V5 حقيقي يوفّر `/api/*`. هما **غير متحققين/متوقفان** ما دام المتغير غير مضبوط؛ Pages ثابتة ولا تعوّض هذا الخادم. اختبارات Node وPython وE2E المحلية تستمر كما هي.
- توجد جدولة الأحد–الخميس وconcurrency لكل مسار. الجدولة القادمة لا تُعد مثبتة حتى يظهر Run فعلي؛ البيانات القديمة تبقى PARTIAL/WAITING_DATA وفق الحراس.
- ملف `quant/config/holidays.json` فارغ. لم نضف عطلة تداول دون إعلان موثّق يخص EGX؛ إعلان عطلة عامة وحده لا يثبت إغلاق البورصة.
- التنفيذ الآلي معطّل؛ لا تعديل للاستراتيجية أو الدرجات أو عتبات الترقية.
