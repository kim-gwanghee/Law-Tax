import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-inter",
});

const SITE_URL = "https://law-tax-production.up.railway.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "LawTax — 세무 법령 검색",
  description: "세무 쟁점, 법령 근거로 즉시 확인. 세무사를 위한 AI 법령 검색 도구.",
  openGraph: {
    type: "website",
    siteName: "LawTax",
    title: "LawTax — 세무 법령 검색",
    description: "세무 쟁점, 법령 근거로 즉시 확인. 세무사를 위한 AI 법령 검색 도구.",
    url: SITE_URL,
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: "LawTax — 세무 법령 검색",
    description: "세무 쟁점, 법령 근거로 즉시 확인. 세무사를 위한 AI 법령 검색 도구.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${inter.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var s=localStorage.getItem('theme');if(s!=='light')document.documentElement.classList.add('dark')})()` }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
