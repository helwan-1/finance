# تطبيق تغييرات إغلاق الواجهة على جهازك (المسار ب)

هذه الملفات الثلاثة تحتوي كل عمل الجلسة (توحيد المصطلحات + الملاحظات الوظيفية #1–#9 + دعم
الاختبارات الإحصائية) — 19 ملفًا فوق النسخة `c1daf96`. طبّقها على جهازك ثم ادفعها.

**الملفات:**
- `sarat-ui-closure.patch` — كل التغييرات.
- `commit-msg.txt` — رسالة الـcommit الكاملة + التذييلات.
- `APPLY-STEPS.md` — هذا الملف.

ضع الملفات الثلاثة داخل مجلد المشروع `C:\finance\finance`.

---

## الخطوات (PowerShell داخل C:\finance\finance)

### 1) تأكّد أنك على الفرع والنسخة الصحيحة
```powershell
cd C:\finance\finance
git fetch origin
git checkout claude/financial-auditor-yejpd7   # أو: git checkout -B claude/financial-auditor-yejpd7 c1daf96
git rev-parse HEAD    # يجب أن يبدأ بـ c1daf96
```

### 2) صحّح الأصل (origin) — مهم جدًا
```powershell
git remote set-url origin https://github.com/helwan-1/finance.git
git remote -v          # تأكّد أنه finance وليس sarat212
```

### 3) طبّق التغييرات
```powershell
git apply --check sarat-ui-closure.patch    # فحص أولًا (بلا مخرجات = سليم)
git apply sarat-ui-closure.patch
git status --short                          # يجب أن ترى 19 عنصرًا
```
> إن أعطى `git apply` خطأ «does not apply»، جرّب: `git apply --3way sarat-ui-closure.patch`

### 4) التزم (commit)
```powershell
git add -A
git commit -F commit-msg.txt
```

### 5) ادفع
```powershell
git push -u origin claude/financial-auditor-yejpd7
```
> **لا** تستخدم force. **لا** تدفع إلى sarat212.

### 6) تحقّق
```powershell
git log --oneline -2                 # commit جديد فوق c1daf96
git status                           # working tree clean
git rev-parse HEAD
git ls-remote origin claude/financial-auditor-yejpd7   # يطابق HEAD المحلي
```

---

## بعد الدفع (اختياري — للتأكد أن كل شيء يعمل)
```powershell
npx tsc --noEmit        # يجب أن يمر
npx next lint           # ✔ بلا أخطاء
npx next build          # Compiled successfully
```

---

## ملاحظات
- الأب المتوقّع للـcommit: `c1daf96301d02536b757492a37594b46353c492a`.
- التغييرات **واجهة/تطبيق فقط**: لا Prisma، لا قاعدة بيانات، لا migration، لا مساس بالأمان أو محرّك التدقيق.
- لا تضف ملف `.env` أو أي أسرار (الـpatch لا يحتوي أيًّا منها).
- إن استخدمت جلسة Claude Code محلية بصلاحيات commit/push، يمكنك ببساطة أن تطلب منها تنفيذ
  الخطوات 3–6 بدل تنفيذها يدويًا.
