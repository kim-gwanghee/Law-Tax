import { NextRequest, NextResponse } from "next/server";
import { buildJO, fetchArticle } from "@/lib/law-article";

const LAW_API_BASE = "https://www.law.go.kr/DRF";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const law = searchParams.get("law");
  const article = searchParams.get("article"); // e.g. "제27조"

  const apiKey = process.env.LAW_API_KEY;
  if (!apiKey)
    return NextResponse.json({ error: "API 키가 설정되지 않았습니다" }, { status: 500 });
  if (!law || !article)
    return NextResponse.json({ error: "law, article 파라미터가 필요합니다" }, { status: 400 });

  try {
    // Step 1: search_law → get MST
    const searchUrl =
      `${LAW_API_BASE}/lawSearch.do?OC=${apiKey}&type=XML&target=law&query=${encodeURIComponent(law)}&display=1&sort=date`;
    const searchRes = await fetch(searchUrl);
    const searchXml = await searchRes.text();

    const mstMatch = searchXml.match(/<법령일련번호>(\d+)<\/법령일련번호>/);
    if (!mstMatch)
      return NextResponse.json({ error: `법령을 찾을 수 없습니다: ${law}` }, { status: 404 });
    const mst = mstMatch[1];

    const lawNameMatch = searchXml.match(/<법령명한글>(.*?)<\/법령명한글>/);
    const foundLawName = lawNameMatch ? lawNameMatch[1] : law;

    // Step 2: get_law_text → fetch article JSON.
    // law.go.kr intermittently returns an HTML error page (rate limit / maintenance)
    // instead of JSON. fetchArticle reads the body as text, parses defensively, and
    // retries once on a transient blip — so it degrades into a clean JSON error the
    // drawer can render, instead of throwing → bare 500 with an empty body → client
    // `r.json()` failing with "Unexpected end of JSON input". Mirrors lib/law-api.ts.
    const joCode = buildJO(article);
    const articleUrl =
      `${LAW_API_BASE}/lawService.do?OC=${apiKey}&target=eflaw&type=JSON&MST=${mst}${joCode ? `&JO=${joCode}` : ""}`;

    const parsed = await fetchArticle(articleUrl, foundLawName);
    if (!parsed.ok) {
      if (parsed.reason === "bad-json")
        return NextResponse.json(
          { error: "법령정보 서비스 응답 오류로 조문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." },
          { status: 502 }
        );
      return NextResponse.json({ error: "조문 데이터를 찾을 수 없습니다" }, { status: 404 });
    }

    const { lawName, effDate, articles } = parsed.data;
    return NextResponse.json({ lawName, article, effDate, articles });
  } catch (err) {
    // Network failure reaching law.go.kr, or any other unexpected throw. Never let
    // the route return a bare 500 with an empty body — the client does r.json() on
    // the response and would crash with "Unexpected end of JSON input".
    console.error("law-article route error:", err);
    return NextResponse.json(
      { error: "조문을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }
}
