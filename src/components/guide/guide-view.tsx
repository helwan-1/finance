"use client";

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
import { useT } from "@/lib/i18n/use-t";

/**
 * In-app user guide — a static, Arabic-first walkthrough of every module,
 * ordered by the real audit workflow. Mirrors the standalone guide but styled
 * with the app's own design tokens so it reads as a native screen. Bilingual:
 * Arabic is the source of truth and the default; English mirrors it faithfully,
 * selected by the active locale.
 */
export function GuideView() {
  const { locale } = useT();
  const isEn = locale === "en";
  const PIPELINE = isEn ? PIPELINE_EN : PIPELINE_AR;
  const SECTIONS = isEn ? SECTIONS_EN : SECTIONS_AR;

  return (
    <div className="space-y-8">
      {/* Overview + pipeline */}
      <section className="surface rounded-xl border p-5 shadow-card">
        <p className="max-w-3xl text-sm leading-7 text-[rgb(var(--muted))]">
          {isEn ? (
            <>
              <b className="text-[rgb(var(--foreground))]">Financial Auditor</b> is a fully deterministic system:
              every result is derived from a predefined rule or test, and every figure is explainable with a
              traceable reference — no artificial intelligence involved. The system is multi-firm with complete data
              isolation, and every action is recorded in an immutable audit log. Follow the steps below in order.
            </>
          ) : (
            <>
              <b className="text-[rgb(var(--foreground))]">مدقّق مالي</b> نظامٌ حتمي بالكامل: كل نتيجة تُشتَقّ من قاعدة
              أو اختبار مُعرَّف مسبقًا، وكل رقم قابل للتفسير وله أثر مرجعي — دون ذكاء اصطناعي. النظام متعدّد المكاتب
              بعزل تام للبيانات، وكل إجراء يُسجَّل في سجلّ تدقيق غير قابل للتعديل. اتبع الخطوات أدناه بالترتيب.
            </>
          )}
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

const PIPELINE_AR = [
  { href: "#documents", title: "المستندات", sub: "رفع واستيراد" },
  { href: "#reconciliation", title: "المطابقة", sub: "مطابقة بنكية" },
  { href: "#rules", title: "القواعد", sub: "محرّك حتمي" },
  { href: "#anomalies", title: "الحالات الشاذة", sub: "لوحة التدقيق" },
  { href: "#audit-tests", title: "الاختبارات", sub: "G4" },
  { href: "#runs", title: "عمليات التدقيق", sub: "تنفيذ ومؤشّرات" },
  { href: "#findings", title: "النتائج", sub: "G5 واعتماد" },
];

const PIPELINE_EN = [
  { href: "#documents", title: "Documents", sub: "Upload & import" },
  { href: "#reconciliation", title: "Reconciliation", sub: "Bank matching" },
  { href: "#rules", title: "Rules", sub: "Deterministic engine" },
  { href: "#anomalies", title: "Anomalies", sub: "Audit board" },
  { href: "#audit-tests", title: "Tests", sub: "G4" },
  { href: "#runs", title: "Audit runs", sub: "Execution & metrics" },
  { href: "#findings", title: "Findings", sub: "G5 & approval" },
];

const SECTIONS_AR: Section[] = [
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

const SECTIONS_EN: Section[] = [
  {
    id: "login",
    title: "Sign in & navigation",
    icon: LogIn,
    tags: ["/login"],
    desc: "Sign in with your account, then use the top bar to control the active engagement, language, and your profile, and the sidebar to move between modules.",
    steps: [
      <>Open the system — it redirects you automatically to the sign-in screen — and enter your email and password.</>,
      <>In the top bar open the <Kbd>engagement switcher</Kbd> and choose an engagement — every screen follows the selected one.</>,
      <>Switch between Arabic and English with the <Kbd>language switcher</Kbd>, and light/dark with the theme button.</>,
    ],
    callouts: [
      {
        kind: "tip",
        text: (
          <>
            <b>Your permissions decide what you see.</b> Partners and managers hold administration and review; the
            staff auditor does the field work without approving findings. To approve a finding, sign in with a
            reviewer account different from the one that prepared it.
          </>
        ),
      },
    ],
  },
  {
    id: "documents",
    title: "Documents & import",
    icon: FileText,
    tags: ["/documents"],
    desc: "The data entry point: upload financial documents, import CSV files into auditable accounting data, and manage the imported datasets.",
    steps: [
      <>Choose the <b>data type</b> before importing: <Kbd>General ledger</Kbd> · <Kbd>Trial balance</Kbd> · <Kbd>Bank statement</Kbd> · <Kbd>Other</Kbd>.</>,
      <>Click <Kbd>Import CSV</Kbd> and pick the file — the import runs in two stages: parse, then confirm.</>,
      <>Review the accepted/rejected row counts and the rejection reasons, then <Kbd>Confirm import</Kbd>.</>,
      <>The dataset appears in the <b>“Imported data”</b> list with its type and date; to delete a wrong dataset use the delete button.</>,
    ],
    elements: [
      ["Data type list", "Determines how the file is interpreted and which columns it requires."],
      ["Import CSV", "Accepts Arabic numerals and thousands separators, and strips the BOM header automatically."],
      ["Imported data", "Each dataset with its type, date, and a delete button."],
    ],
    callouts: [
      {
        kind: "warn",
        text: (
          <>
            <b>The general ledger needs core columns:</b> account code, entry date, and one amount field
            (debit/credit/value). Importing with the wrong type will reject the rows — make sure the type matches
            the file.
          </>
        ),
      },
    ],
  },
  {
    id: "reconciliation",
    title: "Reconciliation",
    icon: GitCompareArrows,
    tags: ["/reconciliation"],
    desc: "Match general-ledger transactions against the bank statement to surface unmatched items.",
    steps: [
      <>Make sure a <b>general ledger</b> and a <b>bank statement</b> are imported for the current engagement.</>,
      <>Open <Kbd>Reconciliation</Kbd> and run the session, then review matched versus unmatched and resolve the differences.</>,
    ],
    callouts: [
      { kind: "tip", text: <>Items that stay unmatched may show up under <b>Anomalies</b> as a signal of discrepancies worth following up.</> },
    ],
  },
  {
    id: "rules",
    title: "Audit rules",
    icon: Scale,
    tags: ["/rules", "Deterministic engine"],
    desc: "Define the rules the engine applies to transactions (split payments, round amounts, after-hours entries…), then run the audit to generate anomalies.",
    steps: [
      <>Browse the built-in rules or add a <b>custom rule</b> with its condition and severity.</>,
      <>Click <Kbd>Run audit</Kbd> to apply the rules to the current engagement’s transactions.</>,
      <>Go to <b>Anomalies</b> to review what was detected.</>,
    ],
    callouts: [
      { kind: "tip", text: <>Every rule is deterministic and explainable: the result repeats on a re-run over the same data, and each case shows why it was flagged.</> },
    ],
  },
  {
    id: "anomalies",
    title: "Anomalies (audit board)",
    icon: ShieldAlert,
    tags: ["/anomalies"],
    desc: "A live monitoring board for every case the rules produced, with stat cards, filtering, export, resolution actions, and a full detail screen for each case.",
    steps: [
      <>Read the <b>top cards</b>: resolved · in progress · high severity · critical cases.</>,
      <>Use the <b>filters</b> (search · severity · rule type · status · date range) to narrow the list.</>,
      <>On any card click <Kbd>Details</Kbd> to view the rule, the evidence, the source transaction, and the resolution history.</>,
      <>For open cases choose <Kbd>Resolve</Kbd>, <Kbd>Dismiss</Kbd>, or <Kbd>Escalate</Kbd> — from the card or the detail dialog.</>,
      <>Export the list via <Kbd>Export PDF</Kbd> or <Kbd>Export Excel</Kbd> when needed.</>,
    ],
    callouts: [
      {
        kind: "tip",
        text: <><b>The “Details” button is always available</b> — even for closed cases — to review their evidence and the record of who resolved them and when.</>,
      },
    ],
  },
  {
    id: "audit-tests",
    title: "Audit tests",
    icon: FlaskConical,
    tags: ["G4", "/audit-tests"],
    desc: "The library of deterministic tests that run on the forensic accounting. Tests are defined at the firm level and shared across engagements, and each test has supported data types.",
    steps: [
      <>Click <Kbd>New test</Kbd> and choose a <b>test type</b> — the system fills in the code, name, and supported data types automatically.</>,
      <>Check that the <b>required data type</b> matches what you will import for the engagement (e.g. duplicate trial-balance accounts requires a trial balance).</>,
      <>Save the test so it becomes available to audit runs.</>,
    ],
    elements: [
      ["Accounting integrity", "Unbalanced entries · invalid debit/credit · duplicate account in the trial balance."],
      ["Data quality", "Statistical-population membership · source-to-forensic match."],
      ["Statistical", "Round-number frequency · repeated amounts."],
    ],
    callouts: [
      {
        kind: "warn",
        text: (
          <>
            Tests are shared at the firm level, but <b>the data and audit runs belong to each engagement</b>. Choosing
            a test whose data is not available in the current engagement is blocked up front in the audit-runs screen.
          </>
        ),
      },
    ],
  },
  {
    id: "runs",
    title: "Audit runs",
    icon: Play,
    tags: ["G4", "/runs"],
    desc: "Execute the tests on a specific engagement’s data through a governed lifecycle that ends in a frozen set of metrics that never change — with an attempts log for every run.",
    steps: [
      <>Create a <b>new audit run</b> for the current engagement.</>,
      <>Choose the imported <b>datasets</b> (each dataset shows its type and date to tell them apart).</>,
      <>Select the <b>tests</b> — any test missing its data appears disabled with the reason it is blocked.</>,
      <>Seal and publish the run, then follow the attempts log until the <Kbd>COMPLETED</Kbd> status.</>,
      <>Open the results to view the <b>metrics</b>.</>,
    ],
    elements: [
      ["Draft → prepare", "Create the run and select the data and tests."],
      ["Seal", "Freezes the scope and transactions so nothing changes afterward."],
      ["Publish → execute", "It enters the execution queue and the background worker processes it."],
      ["Completed", "The final metrics appear with their evidence."],
    ],
    callouts: [
      {
        kind: "crit",
        text: (
          <>
            If the run fails with <b>FAILED (CONFIG)</b>, open the <b>failure reason</b> in the attempts log — usually a
            required data type that was not imported. Import the correct type or remove the unsupported test, then
            re-run.
          </>
        ),
      },
    ],
  },
  {
    id: "audit-results",
    title: "Audit metrics",
    icon: ClipboardList,
    tags: ["/audit-results"],
    desc: "The results of the executed tests — each metric with its evidence and source cells (the entry or trial-balance row it was built on) — the basis for opening an audit issue.",
    steps: [
      <>Open any metric to expand its <b>details</b> and review the <b>source cells</b>.</>,
      <>When something is worth documenting, link the metric to an <b>audit issue</b> in the findings module.</>,
    ],
  },
  {
    id: "findings",
    title: "Audit findings (G5)",
    icon: Gavel,
    tags: ["G5", "/findings"],
    desc: "Document issues, their findings, and their approval within a strict review cycle that enforces segregation of duties. An issue groups the metrics, and beneath it findings move through approved stages.",
    steps: [
      <>Create an <b>audit issue</b> and link the relevant metrics to it.</>,
      <>Add a <b>finding</b> (status, criteria, cause, effect, conclusion, recommendation). The amount and its currency are entered together.</>,
      <>Click <Kbd>Submit for review</Kbd> and the finding becomes <b>under review</b>.</>,
      <>With a <b>different reviewer</b> account click <Kbd>Approve</Kbd> and it becomes <b>approved</b> — or <Kbd>Return</Kbd> with a note.</>,
      <>Close the issue via <Kbd>Close with finding</Kbd> (requires an approved finding) or <Kbd>Close without finding</Kbd>.</>,
    ],
    callouts: [
      {
        kind: "crit",
        text: (
          <>
            <b>Segregation of duties (intended behavior):</b> the preparer of a finding cannot approve it. If you see
            “the reviewer must differ from the preparer,” sign in with another reviewer account. If you see “not a
            member of the engagement,” add them first from <b>Engagement members</b>.
          </>
        ),
      },
    ],
  },
  {
    id: "members",
    title: "Engagement members",
    icon: Users,
    tags: ["From the engagement switcher"],
    desc: "Manage who can prepare, review, and approve within each engagement — ensuring a qualified reviewer is available to enforce segregation of duties without any manual intervention.",
    steps: [
      <>Sign in with an account that has administration permission (partner / engagement manager).</>,
      <>From the <b>engagement switcher</b> choose the engagement, then open <Kbd>Engagement members</Kbd>.</>,
      <>From the <b>“Add member”</b> list pick the user, then <Kbd>Add</Kbd> — they appear among the current members.</>,
      <>To remove a member use the delete button (you cannot remove the last member of an engagement).</>,
    ],
    callouts: [
      { kind: "tip", text: <>The engagement’s creator is added as a member automatically. Add the reviewer manually, since that choice is a professional decision for the firm.</> },
    ],
  },
  {
    id: "analytics",
    title: "Analytics",
    icon: BarChart3,
    tags: ["/analytics"],
    desc: "An aggregate view of the engagement’s metrics and status (including Benford’s Law analysis) to read the overall picture and track progress.",
    steps: [<>Open <Kbd>Analytics</Kbd> after running the audit or the audit runs, and review the distributions to identify areas to focus on.</>],
  },
  {
    id: "audit-log",
    title: "Audit log",
    icon: ScrollText,
    tags: ["/audit-log", "Immutable"],
    desc: "A chronological record of every sensitive action in the system (resolving a case, approving a finding…) — never edited or deleted, and the line of defense for accountability.",
    steps: [<>Open the <Kbd>Audit log</Kbd> to view the most recent events first: actor, action, entity, and time.</>],
  },
  {
    id: "settings",
    title: "Settings",
    icon: Settings,
    tags: ["/settings"],
    desc: "Display and account preferences at the user and firm level (language and theme are also available from the top bar on every screen).",
    callouts: [
      {
        kind: "tip",
        text: (
          <>
            <b>A complete typical workflow:</b> import the ledger, trial balance, and statement → run the rules and
            resolve the cases → define the G4 tests → create an audit run, seal it, and run it → open the metrics →
            document the findings and approve them with a different reviewer → close the issues. Every step is
            recorded in the audit log.
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
                className="rounded-md border px-2 py-0.5 text-[11px] text-[rgb(var(--muted))]"
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
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/5 font-mono text-xs font-semibold text-brand-700 dark:bg-white/10 dark:text-brand-200">
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
  // font-sans is required: the native <kbd> defaults to monospace, which breaks
  // Arabic letter-joining and hurts legibility. Brighter teal text in dark mode.
  return (
    <kbd className="rounded-md bg-brand-50 px-1.5 py-0.5 font-sans text-[12.5px] font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-100">
      {children}
    </kbd>
  );
}
