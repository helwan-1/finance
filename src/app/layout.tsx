import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { LocaleController, LOCALE_NO_FLASH_SCRIPT } from "@/components/layout/locale-controller";
import { ThemeController, THEME_NO_FLASH_SCRIPT } from "@/components/layout/theme-controller";

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
    <html lang="ar" dir="rtl" className={tajawal.variable} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        {/* Apply the saved language's direction before paint (no flash). Kept as
            the first body child — a manual <head> in the App Router root layout
            suppresses Next's automatic stylesheet injection. */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_NO_FLASH_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
        <LocaleController />
        <ThemeController />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
