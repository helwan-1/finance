import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { LocaleController, LOCALE_NO_FLASH_SCRIPT } from "@/components/layout/locale-controller";

// Arabic-first typography.
const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "مدقق مالي — لوحة تدقيق مالي",
  description:
    "لوحة تدقيق مالي مدعومة بالذكاء الاصطناعي: استيعاب المستندات، المطابقة الذكية، وكشف الحالات الشاذة.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <head>
        {/* Apply the saved language's direction before paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <LocaleController />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
