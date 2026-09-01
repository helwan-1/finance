import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";

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
      <body className="min-h-screen font-sans antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
