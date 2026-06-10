// Regression test for lib/law-article.ts — the 조문 drawer parser.
//
// Production bug: law.go.kr intermittently returns an HTML error page (rate limit /
// maintenance) instead of JSON. app/api/law-article/route.ts used to call
// articleRes.json() unguarded → unhandled throw → Next.js bare 500 with an EMPTY
// body → client `r.json()` crashed with "Unexpected end of JSON input".
//
// parseArticleResponse must NEVER throw on a non-JSON body; it returns a typed
// failure the route maps to a clean JSON error. These cases fail against the old
// unguarded JSON.parse path and pass with the defensive parse.
//
// Run: node test-law-article.ts   (Node 24 native TS)
import { buildJO, parseArticleResponse, fetchArticle } from "./lib/law-article.ts";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
}

// ── buildJO: 제129조 → 012900 (the article from the bug report) ──
check("buildJO('제129조') === '012900'", buildJO("제129조") === "012900", `got ${buildJO("제129조")}`);

// ── Case 1: HTML error page instead of JSON → graceful bad-json, no throw ──
const HTML_ERROR_PAGE =
  "<!DOCTYPE html><html><head><title>오류</title></head><body>" +
  "요청을 처리할 수 없습니다 (rate limit)</body></html>";
try {
  const r = parseArticleResponse(HTML_ERROR_PAGE, "소득세법");
  check("HTML page → { ok:false, reason:'bad-json' }", !r.ok && r.reason === "bad-json", JSON.stringify(r));
} catch (e) {
  check("HTML page does not throw", false, (e as Error).message);
}

// ── Case 2: empty body (the exact prod symptom: 0-byte response) → bad-json ──
try {
  const r = parseArticleResponse("", "소득세법");
  check("empty body → { ok:false, reason:'bad-json' }", !r.ok && r.reason === "bad-json", JSON.stringify(r));
} catch (e) {
  check("empty body does not throw", false, (e as Error).message);
}

// ── Case 3: valid JSON but no 법령 key → no-data ──
{
  const r = parseArticleResponse(JSON.stringify({ something: "else" }), "소득세법");
  check("no 법령 key → { ok:false, reason:'no-data' }", !r.ok && r.reason === "no-data", JSON.stringify(r));
}

// ── Case 4: happy path — valid law JSON serializes to drawer articles ──
{
  const payload = {
    법령: {
      기본정보: { 법령명_한글: "소득세법", 시행일자: "20260101" },
      조문: {
        조문단위: {
          조문여부: "조문",
          조문번호: "012900",
          조문제목: "원천징수세율",
          조문내용: "제129조(원천징수세율) ...",
          항: { 항번호: "1", 항내용: "원천징수의무자가 ...", 호: [] },
        },
      },
    },
  };
  const r = parseArticleResponse(JSON.stringify(payload), "소득세법");
  const okShape =
    r.ok &&
    r.data.lawName === "소득세법" &&
    r.data.effDate === "20260101" &&
    r.data.articles.length === 1 &&
    r.data.articles[0].article === "제129조" &&
    r.data.articles[0].title === "원천징수세율";
  check("valid JSON → parsed drawer article", !!okShape, r.ok ? JSON.stringify(r.data.articles[0]) : JSON.stringify(r));
}

// ── Case 5: 편/장/절 header units excluded, only real 조문 kept ──
{
  const payload = {
    법령: {
      기본정보: { 법령명한글: "소득세법" },
      조문: {
        조문단위: [
          { 조문여부: "전문", 조문제목: "제3장 ..." },
          { 조문여부: "조문", 조문번호: "012900", 조문제목: "원천징수세율", 조문내용: "...", 항: [] },
        ],
      },
    },
  };
  const r = parseArticleResponse(JSON.stringify(payload), "소득세법");
  check("header units filtered out", r.ok && r.data.articles.length === 1, r.ok ? `${r.data.articles.length} article(s)` : "not ok");
}

// ── fetchArticle retry behavior (the auto 1-retry on transient failures) ──
const VALID = JSON.stringify({
  법령: { 기본정보: { 법령명_한글: "소득세법" }, 조문: { 조문단위: { 조문여부: "조문", 조문번호: "012900", 조문제목: "원천징수세율", 조문내용: "...", 항: [] } } },
});
const HTML = "<!DOCTYPE html><html>오류</html>";

function fetchSeq(bodies: string[]): { fn: typeof fetch; calls: () => number } {
  let i = 0;
  const fn = (async () => new Response(bodies[Math.min(i++, bodies.length - 1)], { status: 200 })) as typeof fetch;
  return { fn, calls: () => i };
}

// Case 6: first call HTML (transient), retry returns valid → recovers, 2 fetches.
{
  const seq = fetchSeq([HTML, VALID]);
  const r = await fetchArticle("http://x", "소득세법", { fetchImpl: seq.fn, retryDelayMs: 0 });
  check("retry: HTML then valid → recovers", r.ok && seq.calls() === 2, `ok=${r.ok}, fetches=${seq.calls()}`);
}

// Case 7: both calls HTML → bad-json after exactly one retry (2 fetches).
{
  const seq = fetchSeq([HTML, HTML]);
  const r = await fetchArticle("http://x", "소득세법", { fetchImpl: seq.fn, retryDelayMs: 0 });
  check("retry: HTML twice → bad-json, 2 fetches", !r.ok && r.reason === "bad-json" && seq.calls() === 2, `reason=${r.ok ? "ok" : r.reason}, fetches=${seq.calls()}`);
}

// Case 8: valid on first call → no retry (1 fetch only — don't waste a round-trip).
{
  const seq = fetchSeq([VALID, VALID]);
  const r = await fetchArticle("http://x", "소득세법", { fetchImpl: seq.fn, retryDelayMs: 0 });
  check("retry: valid first → no retry, 1 fetch", r.ok && seq.calls() === 1, `ok=${r.ok}, fetches=${seq.calls()}`);
}

// Case 9: network throw then valid → retry recovers.
{
  let i = 0;
  const fn = (async () => {
    if (i++ === 0) throw new Error("ECONNRESET");
    return new Response(VALID, { status: 200 });
  }) as typeof fetch;
  const r = await fetchArticle("http://x", "소득세법", { fetchImpl: fn, retryDelayMs: 0 });
  check("retry: network throw then valid → recovers", r.ok, `ok=${r.ok}`);
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("\nAll law-article parser cases passed");
