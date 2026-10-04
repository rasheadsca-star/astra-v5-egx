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
2. على github.com: *Settings ▸ Pages ▸ Source: Deploy from a branch ▸ `main` / `/docs`*.
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
