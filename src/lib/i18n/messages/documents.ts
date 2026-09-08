/** documents message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const documentsAr = {
  // document-actions.tsx
  "documents.saveFailed": "فشل الحفظ",
  "documents.deleteFailed": "فشل الحذف",
  "documents.edit": "تعديل",
  "documents.delete": "حذف",
  "documents.confirmDeleteDocument": "حذف «{name}» وكل الحركات المستخرجة منه؟",
  "documents.editDocument": "تعديل المستند",
  "documents.fileName": "اسم الملف",
  "documents.type": "النوع",
  "documents.cancel": "إلغاء",
  "documents.save": "حفظ",

  // documents-view.tsx
  "documents.documentCount": "{count} مستند",
  "documents.tipImportName": "«استيراد معاملات (CSV)»",
  "documents.tipImportBody":
    "هو المسار المعتمد في عمليات التدقيق: يقرأ أرقامك كما هي (بلا استخراج تلقائي) ويُنشئ «البيانات المستوردة» التي تعمل عليها عملية التدقيق. أما",
  "documents.tipUploadName": "«رفع مستند»",
  "documents.tipUploadBody": "فيستخرج الحركات آليًا (OCR) للوحة التحكم فقط،",
  "documents.tipUploadEmphasis": "ولا يُستخدم في عمليات التدقيق",
  "documents.tipUploadSuffix": "(ويتطلب تفعيل مفتاح Claude للقراءة الحقيقية).",
  "documents.uploadedOcrDocuments": "مستندات OCR المرفوعة",
  "documents.loadingDocuments": "جارٍ تحميل المستندات...",
  "documents.loadDataFailed": "تعذّر تحميل البيانات.",
  "documents.extractedTransactionsCount": "{count} حركة مستخرجة",

  // import-transactions.tsx
  "documents.kindGeneralLedger": "دفتر الأستاذ",
  "documents.kindTrialBalance": "ميزان المراجعة",
  "documents.kindBank": "كشف بنكي",
  "documents.kindOtherGuideOnly": "أخرى (دليل فقط)",
  "documents.requiredHintGeneralLedger":
    "«رقم الحساب» و«تاريخ القيد» ومبلغًا («مدين»/«دائن»/«المبلغ»)",
  "documents.requiredHintTrialBalance":
    "«رقم الحساب» ورصيدًا واحدًا على الأقل (افتتاحي/حركة/ختامي، مدين أو دائن)",
  "documents.requiredHintBank": "«تاريخ العملية» و«المبلغ»",
  "documents.requiredHintOther": "لا أعمدة إلزامية — يُحفظ كدليل ولا يُنشئ بيانات تدقيق",
  "documents.selectEngagementFirst": "اختر ارتباط تدقيق أولاً",
  "documents.uploadFileFailed": "فشل رفع الملف",
  "documents.confirmImportFailed": "فشل تأكيد الاستيراد",
  "documents.importNoRowsAccepted":
    "⚠️ لم يُقبل أي سطر{rejectedNote}. تحقّق من أعمدة الملف: «{label}» يتطلب {hint}.",
  "documents.importRejectedNote": " (رُفض {rejected})",
  "documents.importSuccess":
    "تم استيراد {accepted} سطراً{rejectedNote} كـ«{label}». البيانات المستوردة جاهزة لإنشاء عملية تدقيق.",
  "documents.importRejectedNoteDash": " — رُفض {rejected}",
  "documents.transactionsTemplate": "قالب المعاملات",
  "documents.dataKind": "نوع البيانات",
  "documents.importedDataKind": "نوع البيانات المستوردة",
  "documents.importCsvAs": "استيراد ملف CSV كـ«{label}»",
  "documents.importTransactionsCsv": "استيراد معاملات (CSV)",

  // imported-datasets.tsx
  "documents.kindOther": "أخرى",
  "documents.datasetStatusCompleted": "مكتملة",
  "documents.datasetStatusCompletedWithIssues": "مكتملة مع ملاحظات",
  "documents.datasetDeleteFailed": "تعذّر حذف مجموعة البيانات",
  "documents.deleteFailedGeneric": "تعذّر الحذف",
  "documents.importedData": "البيانات المستوردة",
  "documents.loading": "جارٍ التحميل…",
  "documents.noImportedData":
    "لا توجد بيانات مستوردة بعد. استخدم «استيراد معاملات (CSV)» أعلاه لإنشاء أول مجموعة.",
  "documents.deleteDatasetTooltip":
    "حذف مجموعة البيانات (يُرفض إن كانت مستخدمة في عملية تدقيق)",
  "documents.confirmDeleteDataset":
    "حذف «{label}»؟ لا يمكن التراجع. (يُرفض إن كانت مستخدمة في عملية تدقيق.)",

  // upload-button.tsx
  "documents.documentType": "نوع المستند",
  "documents.uploadDocument": "رفع مستند",
  "documents.uploadFailed": "فشل الرفع",
} as const;

export const documentsEn: Record<keyof typeof documentsAr, string> = {
  // document-actions.tsx
  "documents.saveFailed": "Save failed",
  "documents.deleteFailed": "Delete failed",
  "documents.edit": "Edit",
  "documents.delete": "Delete",
  "documents.confirmDeleteDocument": "Delete “{name}” and all transactions extracted from it?",
  "documents.editDocument": "Edit document",
  "documents.fileName": "File name",
  "documents.type": "Type",
  "documents.cancel": "Cancel",
  "documents.save": "Save",

  // documents-view.tsx
  "documents.documentCount": "{count} documents",
  "documents.tipImportName": "“Import transactions (CSV)”",
  "documents.tipImportBody":
    "is the approved path in audits: it reads your numbers as-is (no automatic extraction) and creates the “Imported data” that the audit runs on. As for",
  "documents.tipUploadName": "“Upload document”",
  "documents.tipUploadBody": "it extracts transactions automatically (OCR) for the dashboard only,",
  "documents.tipUploadEmphasis": "and is not used in audits",
  "documents.tipUploadSuffix": "(and requires enabling the Claude key for real reading).",
  "documents.uploadedOcrDocuments": "Uploaded OCR documents",
  "documents.loadingDocuments": "Loading documents...",
  "documents.loadDataFailed": "Failed to load data.",
  "documents.extractedTransactionsCount": "{count} extracted transactions",

  // import-transactions.tsx
  "documents.kindGeneralLedger": "General ledger",
  "documents.kindTrialBalance": "Trial balance",
  "documents.kindBank": "Bank statement",
  "documents.kindOtherGuideOnly": "Other (evidence only)",
  "documents.requiredHintGeneralLedger":
    "“Account number”, “Entry date”, and an amount (“Debit”/“Credit”/“Amount”)",
  "documents.requiredHintTrialBalance":
    "“Account number” and at least one balance (opening/movement/closing, debit or credit)",
  "documents.requiredHintBank": "“Transaction date” and “Amount”",
  "documents.requiredHintOther":
    "No required columns — saved as evidence and creates no audit data",
  "documents.selectEngagementFirst": "Select an audit engagement first",
  "documents.uploadFileFailed": "File upload failed",
  "documents.confirmImportFailed": "Import confirmation failed",
  "documents.importNoRowsAccepted":
    "⚠️ No rows were accepted{rejectedNote}. Check the file columns: “{label}” requires {hint}.",
  "documents.importRejectedNote": " ({rejected} rejected)",
  "documents.importSuccess":
    "Imported {accepted} rows{rejectedNote} as “{label}”. The imported data is ready to create an audit.",
  "documents.importRejectedNoteDash": " — {rejected} rejected",
  "documents.transactionsTemplate": "Transactions template",
  "documents.dataKind": "Data type",
  "documents.importedDataKind": "Imported data type",
  "documents.importCsvAs": "Import CSV file as “{label}”",
  "documents.importTransactionsCsv": "Import transactions (CSV)",

  // imported-datasets.tsx
  "documents.kindOther": "Other",
  "documents.datasetStatusCompleted": "Completed",
  "documents.datasetStatusCompletedWithIssues": "Completed with notes",
  "documents.datasetDeleteFailed": "Failed to delete the dataset",
  "documents.deleteFailedGeneric": "Deletion failed",
  "documents.importedData": "Imported data",
  "documents.loading": "Loading…",
  "documents.noImportedData":
    "No imported data yet. Use “Import transactions (CSV)” above to create the first set.",
  "documents.deleteDatasetTooltip": "Delete the dataset (rejected if it is used in an audit)",
  "documents.confirmDeleteDataset":
    "Delete “{label}”? This cannot be undone. (Rejected if it is used in an audit.)",

  // upload-button.tsx
  "documents.documentType": "Document type",
  "documents.uploadDocument": "Upload document",
  "documents.uploadFailed": "Upload failed",
};
