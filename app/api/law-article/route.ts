import { NextRequest, NextResponse } from "next/server";

const LAW_API_BASE = "https://www.law.go.kr/DRF";

// "제27조" or "제27조의2" → "002700" / "002702"
function buildJO(article: string): string {
  const m = article.match(/제(\d+)조(?:의(\d+))?/);
  if (!m) return "";
  const main = parseInt(m[1], 10).toString().padStart(4, "0");
  const branch = m[2] ? parseInt(m[2], 10).toString().padStart(2, "0") : "00";
  return `${main}${branch}`;
}

// "002700" → "제27조", "002702" → "제27조의2"
function parseJO(joCode: string): string {
  const main = parseInt(joCode.slice(0, 4), 10);
  const branch = parseInt(joCode.slice(4, 6), 10);
  return `제${main}조${branch > 0 ? `의${branch}` : ""}`;
}

function normalizeItems<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const law = searchParams.get("law");
  const article = searchParams.get("article"); // e.g. "제27조"

  const apiKey = process.env.LAW_API_KEY;
  if (!apiKey)
    return NextResponse.json({ error: "API 키가 설정되지 않았습니다" }, { status: 500 });
  if (!law || !article)
    return NextResponse.json({ error: "law, article 파라미터가 필요합니다" }, { status: 400 });

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

  // Step 2: get_law_text → fetch article JSON
  const joCode = buildJO(article);
  const articleUrl =
    `${LAW_API_BASE}/lawService.do?OC=${apiKey}&target=eflaw&type=JSON&MST=${mst}${joCode ? `&JO=${joCode}` : ""}`;
  const articleRes = await fetch(articleUrl);
  const json = await articleRes.json();

  const lawData = json?.법령;
  if (!lawData)
    return NextResponse.json({ error: "조문 데이터를 찾을 수 없습니다" }, { status: 404 });

  const basicInfo = lawData.기본정보 || {};
  const lawName = basicInfo.법령명_한글 || basicInfo.법령명한글 || foundLawName;
  const effDate: string = basicInfo.시행일자 || basicInfo.최종시행일자 || "";

  const rawUnits = lawData.조문?.조문단위;
  const units = normalizeItems<Record<string, unknown>>(
    rawUnits as Record<string, unknown> | Record<string, unknown>[] | undefined
  );

  // Filter: keep only actual article units (조문여부 === "조문").
  // The API also returns 편/장/절 header units for the same JO which must be excluded.
  const articleUnits = units.filter((u) => {
    const kind = u.조문여부 as string | undefined;
    return !kind || kind === "조문";
  });

  // Serialize to a clean structure for the client
  const articles = articleUnits.map((u) => {
    const joNum = typeof u.조문번호 === "string" ? parseJO(u.조문번호) : String(u.조문번호 ?? "");
    const clauses = normalizeItems<Record<string, unknown>>(u.항 as never).map((h) => ({
      num: String(h.항번호 ?? ""),
      text: String(h.항내용 ?? ""),
      items: normalizeItems<Record<string, unknown>>(h.호 as never).map((ho) => ({
        num: String(ho.호번호 ?? ""),
        text: String(ho.호내용 ?? ""),
      })),
    }));
    return {
      article: joNum,
      title: String(u.조문제목 ?? ""),
      content: String(u.조문내용 ?? ""),
      clauses,
    };
  });

  return NextResponse.json({ lawName, article, effDate, articles });
}
