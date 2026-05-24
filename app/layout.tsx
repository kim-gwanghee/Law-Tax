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
  title: {
    default: "LawTax — 세무사 전용 AI 법령 검색",
    template: "%s | LawTax",
  },
  description:
    "세무 쟁점을 입력하면 결론·근거 조문·유의사항을 즉시 정리해주는 세무사 전용 AI 법령 검색 서비스. 소득세법, 부가가치세법, 법인세법 등 현행 세법을 신속하게 조회하세요.",
  keywords: [
    "세무사",
    "세법",
    "법령 검색",
    "세무 AI",
    "세법 검색",
    "법령 AI",
    "세무 질의응답",
    "소득세법",
    "부가가치세법",
    "법인세법",
    "세무 자문",
    "법령 조회",
    "세무 도구",
    "LawTax",
    "로택스",
  ],
  authors: [{ name: "LawTax" }],
  alternates: {
    canonical: SITE_URL,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    // Google Search Console 등록 시 발급받은 코드 입력
    google: "",
    // 네이버 서치어드바이저 등록 시 발급받은 코드 입력
    other: { "naver-site-verification": "" },
  },
  openGraph: {
    type: "website",
    siteName: "LawTax",
    title: "LawTax — 세무사 전용 AI 법령 검색",
    description:
      "세무 쟁점을 입력하면 결론·근거 조문·유의사항을 즉시 정리해주는 세무사 전용 AI 법령 검색 서비스.",
    url: SITE_URL,
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: "LawTax — 세무사 전용 AI 법령 검색",
    description:
      "세무 쟁점을 입력하면 결론·근거 조문·유의사항을 즉시 정리해주는 세무사 전용 AI 법령 검색 서비스.",
  },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "LawTax",
  alternateName: "로택스",
  description:
    "세무사 전용 AI 법령 검색 서비스. 세무 쟁점에 대한 결론·근거 조문·유의사항을 즉시 정리합니다.",
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  inLanguage: "ko-KR",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "KRW",
    availability: "https://schema.org/InStock",
  },
  audience: {
    "@type": "Audience",
    audienceType: "세무사",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var s=localStorage.getItem('theme');if(s!=='light')document.documentElement.classList.add('dark')})()` }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
