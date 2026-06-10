// Pure parsing/serialization for the 조문 (law article) drawer.
// Intentionally has NO `next/server` import so it is unit-testable under plain
// `node lib/...` the same way lib/law-api.ts is. app/api/law-article/route.ts does
// the HTTP/fetch shell and delegates the parsing here.

// "제27조" / "제27조의2" → "002700" / "002702"
export function buildJO(article: string): string {
  const m = article.match(/제?\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
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

export type DrawerClause = { num: string; text: string; items: { num: string; text: string }[] };
export type DrawerArticle = { article: string; title: string; content: string; clauses: DrawerClause[] };
export type DrawerData = { lawName: string; effDate: string; articles: DrawerArticle[] };

// Parse outcome: either usable data, or a typed failure the route maps to an HTTP
// status. `bad-json` is the production bug — law.go.kr intermittently returns an
// HTML error page (rate limit / maintenance) instead of JSON. Returning a typed
// failure (instead of letting JSON.parse throw) is what keeps the route from
// emitting a bare 500 with an empty body that crashes the client's r.json().
export type ParseArticleResult =
  | { ok: true; data: DrawerData }
  | { ok: false; reason: "bad-json" | "no-data" };

export function parseArticleResponse(raw: string, fallbackLawName: string): ParseArticleResult {
  let json: { 법령?: Record<string, unknown> };
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "bad-json" };
  }

  const lawData = json?.법령 as Record<string, unknown> | undefined;
  if (!lawData) return { ok: false, reason: "no-data" };

  const basicInfo = (lawData.기본정보 as Record<string, unknown>) || {};
  const lawName = String(basicInfo.법령명_한글 || basicInfo.법령명한글 || fallbackLawName);
  const effDate = String(basicInfo.시행일자 || basicInfo.최종시행일자 || "");

  const rawUnits = (lawData.조문 as Record<string, unknown> | undefined)?.조문단위;
  const units = normalizeItems<Record<string, unknown>>(
    rawUnits as Record<string, unknown> | Record<string, unknown>[] | undefined
  );

  // Keep only actual article units (조문여부 === "조문"). The API also returns
  // 편/장/절 header units for the same JO which must be excluded.
  const articleUnits = units.filter((u) => {
    const kind = u.조문여부 as string | undefined;
    return !kind || kind === "조문";
  });

  const articles: DrawerArticle[] = articleUnits.map((u) => {
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

  return { ok: true, data: { lawName, effDate, articles } };
}

// Fetch the lawService.do article JSON and parse it, with one automatic retry on a
// transient failure. "Transient" = the documented law.go.kr blips: a non-JSON body
// (bad-json) or a network throw. A `no-data` result (real "article not found") is
// NOT retried — retrying it would just burn another round-trip. fetchImpl/retryDelayMs
// are injectable so the retry path is unit-testable without real network or timers.
export async function fetchArticle(
  url: string,
  fallbackLawName: string,
  { fetchImpl = fetch, retryDelayMs = 400 }: { fetchImpl?: typeof fetch; retryDelayMs?: number } = {}
): Promise<ParseArticleResult> {
  const attempt = async (): Promise<ParseArticleResult> => {
    const res = await fetchImpl(url);
    return parseArticleResponse(await res.text(), fallbackLawName);
  };

  try {
    const first = await attempt();
    if (first.ok || first.reason !== "bad-json") return first;
  } catch {
    // network blip on the first try — fall through to the single retry
  }

  if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
  return attempt(); // last attempt; if it throws, the route's outer catch → clean 502
}
