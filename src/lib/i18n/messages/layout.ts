/** layout message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const layoutAr = {
  // Engagement switcher
  "layout.noEngagements": "لا توجد مهام",
  "layout.members": "أعضاء المهمة",
  "layout.newEngagement": "مهمة تدقيق جديدة",
  "layout.createError": "فشل الإنشاء",
  "layout.existingCompany": "شركة موجودة",
  "layout.newClient": "عميل جديد",
  "layout.company": "الشركة",
  "layout.selectCompany": "— اختر شركة —",
  "layout.clientName": "اسم العميل",
  "layout.clientNamePlaceholder": "شركة ...",
  "layout.engagementTitle": "عنوان المهمة",
  "layout.engagementTitlePlaceholder": "المراجعة النظامية 2027",
  "layout.fiscalYear": "السنة المالية",
  "layout.cancel": "إلغاء",
  "layout.create": "إنشاء",

  // Members dialog
  "layout.addError": "فشل الإضافة",
  "layout.removeError": "فشل الإزالة",
  "layout.membersInfo":
    "العضوية تحدّد من يُعِدّ ويُراجِع ويعتمد نتائج التدقيق. اعتماد نتيجة يتطلب مُراجِعًا عضوًا في المهمة ومختلفًا عن مُعِدّها (فصل المهام).",
  "layout.addMember": "إضافة عضو",
  "layout.noAvailableUsers": "— لا يوجد مستخدمون متاحون —",
  "layout.selectUser": "— اختر مستخدمًا —",
  "layout.add": "إضافة",
  "layout.currentMembers": "الأعضاء الحاليون ({count})",
  "layout.loading": "جارٍ التحميل…",
  "layout.noMembers": "لا يوجد أعضاء.",
  "layout.cannotRemoveLast": "لا يمكن إزالة آخر عضو",
  "layout.remove": "إزالة",
  "layout.confirmRemove": "إزالة {name} من المهمة؟",
  "layout.close": "إغلاق",

  // Live indicator
  "layout.liveActiveTitle": "التحديثات المباشرة نشطة",
  "layout.offline": "غير متصل",
  "layout.live": "مباشر",

  // Auth — user menu
  "auth.demoName": "سارة الحربي",
  "auth.demoRole": "نسخة تجريبية",
  "auth.signOut": "تسجيل الخروج",
  "auth.signIn": "تسجيل الدخول",

  // Auth — login form
  "auth.loginError": "تعذّر تسجيل الدخول",
  "auth.connectionError": "تعذّر الاتصال بالخادم",
  "auth.brand": "مدقق مالي",
  "auth.loginSubtitle": "تسجيل الدخول إلى لوحة التدقيق",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
} as const;

export const layoutEn: Record<keyof typeof layoutAr, string> = {
  "layout.noEngagements": "No engagements",
  "layout.members": "Engagement Members",
  "layout.newEngagement": "New Audit Engagement",
  "layout.createError": "Creation failed",
  "layout.existingCompany": "Existing company",
  "layout.newClient": "New client",
  "layout.company": "Company",
  "layout.selectCompany": "— Select a company —",
  "layout.clientName": "Client name",
  "layout.clientNamePlaceholder": "Company ...",
  "layout.engagementTitle": "Engagement title",
  "layout.engagementTitlePlaceholder": "Statutory audit 2027",
  "layout.fiscalYear": "Fiscal year",
  "layout.cancel": "Cancel",
  "layout.create": "Create",

  "layout.addError": "Failed to add",
  "layout.removeError": "Failed to remove",
  "layout.membersInfo":
    "Membership governs who prepares, reviews, and approves audit findings. Approving a finding requires a reviewer who is a member of the engagement and different from its preparer (segregation of duties).",
  "layout.addMember": "Add member",
  "layout.noAvailableUsers": "— No available users —",
  "layout.selectUser": "— Select a user —",
  "layout.add": "Add",
  "layout.currentMembers": "Current members ({count})",
  "layout.loading": "Loading…",
  "layout.noMembers": "No members.",
  "layout.cannotRemoveLast": "Cannot remove the last member",
  "layout.remove": "Remove",
  "layout.confirmRemove": "Remove {name} from the engagement?",
  "layout.close": "Close",

  "layout.liveActiveTitle": "Live updates are active",
  "layout.offline": "Offline",
  "layout.live": "Live",

  "auth.demoName": "Sara Al-Harbi",
  "auth.demoRole": "Preview",
  "auth.signOut": "Sign out",
  "auth.signIn": "Sign in",

  "auth.loginError": "Sign-in failed",
  "auth.connectionError": "Could not connect to the server",
  "auth.brand": "Financial Auditor",
  "auth.loginSubtitle": "Sign in to the audit dashboard",
  "auth.email": "Email",
  "auth.password": "Password",
};
