import {
  FileText,
  GitCompareArrows,
  Scale,
  ShieldAlert,
  FlaskConical,
  Play,
  ClipboardList,
  Gavel,
  Users,
  BarChart3,
  ScrollText,
  Settings,
  LogIn,
  Lightbulb,
  AlertTriangle,
  Ban,
  type LucideIcon,
} from "lucide-react";

/**
 * In-app user guide — a static, Arabic-first walkthrough of every module,
 * ordered by the real audit workflow. Mirrors the standalone guide but styled
 * with the app's own design tokens so it reads as a native screen.
 */
export function GuideView() {
  return (
    <div className="space-y-8">
      {/* Overview + pipeline */}
      <section className="surface rounded-xl border p-5 shadow-card">
        <p className="max-w-3xl text-sm leading-7 text-[rgb(var(--muted))]">
          <b className="text-[rgb(var(--foreground))]">مدقّق مالي</b> نظامٌ حتمي بالكامل: كل نتيجة تُشتَقّ من قاعدة
          أو اختبار مُعرَّف مسبقًا، وكل رقم قابل للتفسير وله أثر مرجعي — دون ذكاء اصطناعي. النظام متعدّد المكاتب
          بعزل تام للبيانات، وكل إجراء يُسجَّل في سجلّ تدقيق غير قابل للتعديل. اتبع الخطوات أدناه بالترتيب.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {PIPELINE.map((p, i) => (
            <a
              key={p.href}
              href={p.href}
              className="group rounded-lg border p-3 transition-colors hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-700/15"
            >
              <div className="mb-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">
                {i + 1}
              </div>
              <span className="block text-[13px] font-semibold">{p.title}</span>
              <span className="block text-[11px] text-[rgb(var(--muted))]">{p.sub}</span>
            </a>
          ))}
        </div>
      </section>

      {/* Quick nav */}
      <nav className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border px-3 py-1 text-xs text-[rgb(var(--muted))] hover:bg-black/5 dark:hover:bg-white/5"
          >
            {s.title}
          </a>
        ))}
      </nav>

      {/* Sections */}
      <div className="space-y-10">
        {SECTIONS.map((s) => (
          <Module key={s.id} section={s} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- data */

interface Callout {
  kind: "tip" | "warn" | "crit";
  text: React.ReactNode;
}
interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  tags?: string[];
  desc: React.ReactNode;
  steps?: React.ReactNode[];
  elements?: [string, React.ReactNode][];
  callouts?: Callout[];
}

const PIPELINE = [
  { href: "#documents", title: "المستندات", sub: "رفع واستيراد" },
  { href: "#reconciliation", title: "المطابقة", sub: "مطابقة بنكية" },
  { href: "#rules", title: "القواعد", sub: "محرّك حتمي" },
  { href: "#anomalies", title: "الحالات الشاذة", sub: "لوحة التدقيق" },
  { href: "#audit-tests", title: "الاختبارات", sub: "G4" },
  { href: "#runs", title: "عمليات التدقيق", sub: "تنفيذ ومؤشّرات" },
  { href: "#findings", title: "النتائج", sub: "G5 واعتماد" },
];

const SECTIONS: Section[] = [
  {
    id: "login",
    title: "الدخول والتنقّل",
    icon: LogIn,
    tags: ["/login"],
    desc: "تسجّل الدخول بحسابك، ثم تتحكّم من الشريط العلوي في المهمة النشطة واللغة وحسابك، ومن الشريط الجانبي تنتقل بين الوحدات.",
    steps: [
      <>افتح النظام فيُحوّلك تلقائيًا إلى شاشة الدخول، وأدخل البريد وكلمة المرور.</>,
      <>من الشريط العلوي افتح <Kbd>مبدّل المهام</Kbd> واختر المهمة — كل الشاشات تتبع المهمة المختارة.</>,
      <>بدّل بين العربية والإنجليزية من <Kbd>مبدّل اللغة</Kbd>، والوضع الفاتح/الداكن من زر الوضع.</>,
    ],
    callouts: [
      {
        kind: "tip",
        text: (
          <>
            <b>الصلاحيات تحكم ما تراه.</b> الشريك والمدير يملكان الإدارة والمراجعة؛ المدقّق الأول يقوم بالعمل الميداني
            دون اعتماد النتائج. لاعتماد نتيجة، سجّل الدخول بحساب مُراجِع مختلف عن مُعِدّها.
          </>
        ),
      },
    ],
  },
  {
    id: "documents",
    title: "المستندات والاستيراد",
    icon: FileText,
    tags: ["/documents"],
    desc: "نقطة إدخال البيانات: رفع المستندات المالية، واستيراد ملفات CSV إلى بيانات محاسبية قابلة للتدقيق، وإدارة المجموعات المستوردة.",
    steps: [
      <>اختر <b>نوع البيانات</b> قبل الاستيراد: <Kbd>دفتر أستاذ</Kbd> · <Kbd>ميزان مراجعة</Kbd> · <Kbd>كشف بنكي</Kbd> · <Kbd>أخرى</Kbd>.</>,
      <>اضغط <Kbd>استيراد CSV</Kbd> واختر الملف — يبدأ الاستيراد على مرحلتين: تحليل ثم تأكيد.</>,
      <>راجع عدد الصفوف المقبولة/المرفوضة وأسباب الرفض، ثم <Kbd>تأكيد الاستيراد</Kbd>.</>,
      <>تظهر المجموعة في قائمة <b>«البيانات المستوردة»</b> مع نوعها وتاريخها؛ ولحذف مجموعة خاطئة استخدم زر الحذف.</>,
    ],
    elements: [
      ["قائمة نوع البيانات", "تحدّد كيف يُفسَّر الملف والأعمدة المطلوبة منه."],
      ["استيراد CSV", "يقبل الأرقام العربية وفواصل الآلاف ويزيل ترويسة BOM تلقائيًا."],
      ["البيانات المستوردة", "كل مجموعة مع النوع والتاريخ وزر حذف."],
    ],
    callouts: [
      {
        kind: "warn",
        text: (
          <>
            <b>دفتر الأستاذ يحتاج أعمدة أساسية:</b> رمز الحساب، تاريخ القيد، وأحد حقول المبلغ (مدين/دائن/قيمة).
            الاستيراد بنوع خاطئ سيرفض الصفوف — تأكّد من مطابقة النوع للملف.
          </>
        ),
      },
    ],
  },
  {
    id: "reconciliation",
    title: "المطابقة",
    icon: GitCompareArrows,
    tags: ["/reconciliation"],
    desc: "مطابقة حركات دفتر الأستاذ مع كشف الحساب البنكي لاكتشاف البنود غير المطابقة.",
    steps: [
      <>تأكّد من استيراد <b>دفتر أستاذ</b> و<b>كشف بنكي</b> للمهمة الحالية.</>,
      <>افتح <Kbd>المطابقة</Kbd> وشغّل الجلسة، ثم راجع المطابَق مقابل غير المطابَق وعالِج الفروقات.</>,
    ],
    callouts: [
      { kind: "tip", text: <>البنود التي تبقى دون مطابقة قد تظهر في <b>الحالات الشاذة</b> كإشارة إلى فروقات تستحق المتابعة.</> },
    ],
  },
  {
    id: "rules",
    title: "قواعد التدقيق",
    icon: Scale,
    tags: ["/rules", "محرّك حتمي"],
    desc: "تُعرّف القوانين التي يطبّقها المحرّك على المعاملات (مدفوعات مقسّمة، مبالغ مستديرة، قيود خارج الدوام…)، ثم تُشغّل التدقيق فتتولّد الحالات الشاذة.",
    steps: [
      <>استعرض القواعد الجاهزة أو أضف <b>قاعدة مخصّصة</b> بشرطها ودرجة خطورتها.</>,
      <>اضغط <Kbd>تشغيل التدقيق</Kbd> لتطبيق القواعد على معاملات المهمة الحالية.</>,
      <>انتقل إلى <b>الحالات الشاذة</b> لمراجعة ما رُصد.</>,
    ],
    callouts: [
      { kind: "tip", text: <>كل قاعدة حتمية ومُفسَّرة: النتيجة تتكرّر عند إعادة التشغيل على البيانات نفسها، ويظهر لكل حالة سبب رصدها.</> },
    ],
  },
  {
    id: "anomalies",
    title: "الحالات الشاذة (لوحة التدقيق)",
    icon: ShieldAlert,
    tags: ["/anomalies"],
    desc: "لوحة رصد حيّة لكل الحالات التي أنتجتها القواعد، مع بطاقات إحصائية، وفلترة، وتصدير، وإجراءات معالجة، وشاشة تفاصيل كاملة لكل حالة.",
    steps: [
      <>اقرأ <b>البطاقات العلوية</b>: تمت المعالجة · قيد المتابعة · خطورة عالية · حالات حرجة.</>,
      <>استخدم <b>الفلاتر</b> (بحث · الخطورة · نوع القاعدة · الحالة · نطاق التاريخ) لتضييق القائمة.</>,
      <>على أي بطاقة اضغط <Kbd>التفاصيل</Kbd> لعرض القاعدة والأدلّة والمعاملة المصدرية وسجل المعالجة.</>,
      <>للحالات المفتوحة اختر <Kbd>معالجة</Kbd> أو <Kbd>استبعاد</Kbd> أو <Kbd>تصعيد</Kbd> — من البطاقة أو من نافذة التفاصيل.</>,
      <>صدّر القائمة عبر <Kbd>تصدير PDF</Kbd> أو <Kbd>تصدير Excel</Kbd> عند الحاجة.</>,
    ],
    callouts: [
      {
        kind: "tip",
        text: <><b>زر «التفاصيل» متاح دائمًا</b> — حتى للحالات المُغلقة — لمراجعة أدلّتها وسجل من عالجها ومتى.</>,
      },
    ],
  },
  {
    id: "audit-tests",
    title: "اختبارات التدقيق",
    icon: FlaskConical,
    tags: ["G4", "/audit-tests"],
    desc: "مكتبة الاختبارات الحتمية التي تعمل على المحاسبة القانونية. الاختبارات مُعرّفة على مستوى المكتب وتُشارَك بين المهام، ولكل اختبار أنواع بيانات مدعومة.",
    steps: [
      <>اضغط <Kbd>اختبار جديد</Kbd> واختر <b>نوع الاختبار</b> فيملأ النظام الرمز والاسم وأنواع البيانات المدعومة تلقائيًا.</>,
      <>راجع أن <b>نوع البيانات المطلوب</b> يطابق ما ستستورده للمهمة (مثلاً تكرار حسابات الميزان يتطلّب ميزان مراجعة).</>,
      <>احفظ الاختبار ليصبح متاحًا لعمليات التدقيق.</>,
    ],
    elements: [
      ["سلامة محاسبية", "قيود غير متوازنة · مدين/دائن غير صالح · تكرار حساب في الميزان."],
      ["جودة البيانات", "عضوية المجتمع الإحصائي · تطابق المصدر مع القانوني."],
      ["إحصائية", "تكرار الأرقام المستديرة · تكرار المبالغ."],
    ],
    callouts: [
      {
        kind: "warn",
        text: (
          <>
            الاختبارات مشتركة على مستوى المكتب، لكن <b>البيانات وعمليات التدقيق تخصّ كل مهمة</b>. اختيار اختبار
            لا تتوفّر بياناته في المهمة الحالية سيُمنع مسبقًا في شاشة عمليات التدقيق.
          </>
        ),
      },
    ],
  },
  {
    id: "runs",
    title: "عمليات التدقيق",
    icon: Play,
    tags: ["G4", "/runs"],
    desc: "تنفيذ الاختبارات على بيانات مهمة محدّدة عبر دورة حياة محكومة، تنتهي بمجموعة مؤشّرات مُجمّدة لا تتغيّر — مع سجلّ محاولات لكل عملية.",
    steps: [
      <>أنشئ <b>عملية تدقيق جديدة</b> للمهمة الحالية.</>,
      <>اختر <b>مجموعات البيانات</b> المستوردة (يظهر لكل مجموعة نوعها وتاريخها لتمييزها).</>,
      <>حدّد <b>الاختبارات</b> — أي اختبار تنقصه بياناته يظهر معطّلاً مع سبب المنع.</>,
      <>اختم العملية وانشرها، ثم تابع سجلّ المحاولات حتى الحالة <Kbd>COMPLETED</Kbd>.</>,
      <>افتح النتائج لعرض <b>المؤشّرات</b>.</>,
    ],
    elements: [
      ["مسودة ← تحضير", "تُنشئ العملية وتختار البيانات والاختبارات."],
      ["الختم (Seal)", "تُجمّد النطاق والمعاملات فلا يتغيّر بعدها."],
      ["النشر ← التنفيذ", "تدخل قائمة التنفيذ ويعالجها المُشغّل الخلفي."],
      ["مكتملة", "تظهر المؤشّرات النهائية بأدلّتها."],
    ],
    callouts: [
      {
        kind: "crit",
        text: (
          <>
            إن فشلت العملية بحالة <b>FAILED (CONFIG)</b>، افتح <b>سبب الفشل</b> في سجلّ المحاولات — غالبًا نوع بيانات
            مطلوب غير مستورد. استورد النوع الصحيح أو أزل الاختبار غير المدعوم ثم أعد التشغيل.
          </>
        ),
      },
    ],
  },
  {
    id: "audit-results",
    title: "مؤشّرات التدقيق",
    icon: ClipboardList,
    tags: ["/audit-results"],
    desc: "نتائج الاختبارات المُنفّذة، كل مؤشّر مع أدلّته وخلاياه المصدرية (القيد أو صف الميزان الذي بُني عليه) — أساسٌ لفتح مسألة تدقيق.",
    steps: [
      <>افتح أي مؤشّر لتوسيع <b>تفاصيله</b> ومراجعة <b>الخلايا المصدرية</b>.</>,
      <>عند وجود ما يستحق التوثيق، اربط المؤشّر بـ <b>مسألة تدقيق</b> في وحدة النتائج.</>,
    ],
  },
  {
    id: "findings",
    title: "نتائج التدقيق (G5)",
    icon: Gavel,
    tags: ["G5", "/findings"],
    desc: "توثيق المسائل ونتائجها واعتمادها ضمن دورة مراجعة صارمة تطبّق فصل المهام. المسألة تجمع المؤشّرات، وتحتها نتائج تدقيق تمرّ بمراحل معتمدة.",
    steps: [
      <>أنشئ <b>مسألة تدقيق</b> واربط بها المؤشّرات ذات العلاقة.</>,
      <>أضِف <b>نتيجة تدقيق</b> (الحالة، المعيار، السبب، الأثر، الاستنتاج، التوصية). المبلغ وعملته يُدخَلان معًا.</>,
      <>اضغط <Kbd>إرسال للمراجعة</Kbd> فتصبح النتيجة <b>قيد المراجعة</b>.</>,
      <>بحساب <b>مُراجِع مختلف</b> اضغط <Kbd>اعتماد</Kbd> فتصبح <b>معتمدة</b> — أو <Kbd>إرجاع</Kbd> مع ملاحظة.</>,
      <>أغلق المسألة عبر <Kbd>إغلاق مع نتيجة تدقيق</Kbd> (يتطلّب نتيجة معتمدة) أو <Kbd>إغلاق دون نتيجة</Kbd>.</>,
    ],
    callouts: [
      {
        kind: "crit",
        text: (
          <>
            <b>فصل المهام (سلوك مقصود):</b> لا يعتمد نتيجةً مَن أعدّها. إن ظهر «المُراجِع يجب أن يختلف عن المُعِدّ» فسجّل
            الدخول بحساب مُراجِع آخر. وإن ظهر «ليس عضوًا في المهمة» فأضِفه أولًا من <b>أعضاء المهمة</b>.
          </>
        ),
      },
    ],
  },
  {
    id: "members",
    title: "أعضاء المهمة",
    icon: Users,
    tags: ["من مبدّل المهام"],
    desc: "إدارة من يستطيع الإعداد والمراجعة والاعتماد داخل كل مهمة — تضمن توفّر مُراجِع مؤهّل لتطبيق فصل المهام دون أي تدخّل يدوي.",
    steps: [
      <>سجّل الدخول بحساب له صلاحية الإدارة (شريك/مدير مهمة).</>,
      <>من <b>مبدّل المهام</b> اختر المهمة ثم افتح <Kbd>أعضاء المهمة</Kbd>.</>,
      <>من قائمة <b>«إضافة عضو»</b> اختر المستخدم ثم <Kbd>إضافة</Kbd> — يظهر ضمن الأعضاء الحاليين.</>,
      <>لإزالة عضو استخدم زر الحذف (لا يمكن إزالة آخر عضو في المهمة).</>,
    ],
    callouts: [
      { kind: "tip", text: <>مُنشئ المهمة يُضاف عضوًا تلقائيًا. أضِف المُراجِع يدويًا لأنّ اختياره قرار مهني يخصّ المكتب.</> },
    ],
  },
  {
    id: "analytics",
    title: "التحليلات",
    icon: BarChart3,
    tags: ["/analytics"],
    desc: "نظرة تجميعية على مؤشّرات المهمة وحالتها (منها تحليل قانون بنفورد) لقراءة الصورة الكلّية ومتابعة التقدّم.",
    steps: [<>افتح <Kbd>التحليلات</Kbd> بعد تشغيل التدقيق أو عمليات التدقيق، وراجع التوزيعات لتحديد مناطق التركيز.</>],
  },
  {
    id: "audit-log",
    title: "سجل التدقيق",
    icon: ScrollText,
    tags: ["/audit-log", "غير قابل للتعديل"],
    desc: "سجلّ زمني لكل إجراء حسّاس في النظام (معالجة حالة، اعتماد نتيجة…) — لا يُحرَّر ولا يُحذف، ويُشكّل خطّ الدفاع للمساءلة.",
    steps: [<>افتح <Kbd>سجل التدقيق</Kbd> لعرض الأحداث الأحدث أولًا: الفاعل والإجراء والكيان والوقت.</>],
  },
  {
    id: "settings",
    title: "الإعدادات",
    icon: Settings,
    tags: ["/settings"],
    desc: "تفضيلات العرض والحساب على مستوى المستخدم والمكتب (اللغة والوضع متاحان أيضًا من الشريط العلوي في كل الشاشات).",
    callouts: [
      {
        kind: "tip",
        text: (
          <>
            <b>مسار عمل نموذجي كامل:</b> استورد دفتر الأستاذ والميزان والكشف ← شغّل القواعد وعالِج الحالات ← عرّف اختبارات
            G4 ← أنشئ عملية تدقيق واختمها وشغّلها ← افتح المؤشّرات ← وثّق النتائج واعتمدها بمُراجِع مختلف ← أغلق المسائل.
            كل خطوة مُسجَّلة في سجل التدقيق.
          </>
        ),
      },
    ],
  },
];

/* ---------------------------------------------------------------- pieces */

function Module({ section }: { section: Section }) {
  const Icon = section.icon;
  return (
    <section id={section.id} className="scroll-mt-24">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-700/15 dark:text-brand-300">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-bold">{section.title}</h2>
        {section.tags && (
          <div className="flex flex-wrap gap-1.5">
            {section.tags.map((t) => (
              <span
                key={t}
                className="rounded-md border px-2 py-0.5 font-mono text-[11px] text-[rgb(var(--muted))]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mb-4 max-w-3xl text-sm leading-7 text-[rgb(var(--muted))]">{section.desc}</p>

      {section.steps && (
        <ol className="mb-4 space-y-2">
          {section.steps.map((step, i) => (
            <li
              key={i}
              className="surface flex gap-3 rounded-lg border p-3 text-sm leading-6"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/5 font-mono text-xs font-semibold text-brand-700 dark:bg-white/5 dark:text-brand-300">
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {section.elements && (
        <div className="mb-4 overflow-hidden rounded-xl border">
          {section.elements.map(([k, v], i) => (
            <div
              key={k}
              className={`grid grid-cols-1 gap-1 p-3 text-sm sm:grid-cols-[200px_1fr] sm:gap-4 ${
                i > 0 ? "border-t" : ""
              }`}
            >
              <span className="font-semibold">{k}</span>
              <span className="text-[rgb(var(--muted))]">{v}</span>
            </div>
          ))}
        </div>
      )}

      {section.callouts?.map((c, i) => (
        <CalloutBox key={i} callout={c} />
      ))}
    </section>
  );
}

const CALLOUT_STYLE: Record<Callout["kind"], { box: string; icon: LucideIcon; iconColor: string }> = {
  tip: {
    box: "border-brand-600/30 bg-brand-50 dark:bg-brand-700/15",
    icon: Lightbulb,
    iconColor: "text-brand-600 dark:text-brand-300",
  },
  warn: {
    box: "border-severity-high/40 bg-severity-high/10",
    icon: AlertTriangle,
    iconColor: "text-severity-high",
  },
  crit: {
    box: "border-severity-critical/40 bg-severity-critical/10",
    icon: Ban,
    iconColor: "text-severity-critical",
  },
};

function CalloutBox({ callout }: { callout: Callout }) {
  const style = CALLOUT_STYLE[callout.kind];
  const Icon = style.icon;
  return (
    <div className={`mt-2 flex gap-3 rounded-xl border p-3.5 text-sm leading-6 ${style.box}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.iconColor}`} />
      <div className="min-w-0">{callout.text}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 dark:bg-brand-700/20 dark:text-brand-300">
      {children}
    </kbd>
  );
}
