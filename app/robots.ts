import type { MetadataRoute } from "next";

const SITE_URL = "https://law-tax-production.up.railway.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login"],
        disallow: ["/api/", "/auth/"],
      },
      // 네이버 봇은 별도 명시하면 인덱싱 우선순위가 올라가는 경우가 있음
      {
        userAgent: ["Yeti", "NaverBot"],
        allow: ["/", "/login"],
        disallow: ["/api/", "/auth/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
