// Direct law.go.kr DRF client. Replaces the korean-law-mcp stdio subprocess:
// same two endpoints (lawSearch.do + lawService.do) the chat flow actually used,
// called in-process so there is no second Node process / MCP handshake per query.
const LAW_API_BASE = "https://www.law.go.kr/DRF";

function apiKey(): string {
  const k = process.env.LAW_API_KEY;
  if (!k) throw new Error("LAW_API_KEY 미설정");
  return k;
}

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

// In-memory MST cache, process lifetime. The Fly app is always-on so this
// survives across requests; 24h TTL bounds staleness from amendments (MST/
// 법령일련번호 can change when a law is amended). A deploy also clears it.
type MstEntry = { mst: string; lawName: string; ts: number };
const mstCache = new Map<string, MstEntry>();
const MST_TTL = 24 * 60 * 60 * 1000;

async function resolveMst(query: string, signal?: AbortSignal): Promise<MstEntry | null> {
  const key = query.trim();
  const hit = mstCache.get(key);
  if (hit && Date.now() - hit.ts < MST_TTL) return hit;

  const url = `${LAW_API_BASE}/lawSearch.do?OC=${apiKey()}&type=XML&target=law&query=${encodeURIComponent(key)}&display=1&sort=date`;
  const res = await fetch(url, { signal });
  const xml = await res.text();

  const mstMatch = xml.match(/<법령일련번호>(\d+)<\/법령일련번호>/);
  if (!mstMatch) return null;
  const nameMatch = xml.match(/<법령명한글>(.*?)<\/법령명한글>/);
  const entry: MstEntry = { mst: mstMatch[1], lawName: nameMatch ? nameMatch[1] : key, ts: Date.now() };
  mstCache.set(key, entry);
  return entry;
}

export type LawToolResult = {
  text: string;        // model-facing text
  lawName: string;     // canonical law name (for citations)
  article: string;     // article label e.g. "제27조" (for citations)
};

// search_law: 정식 법률명 → MST. Cached, so repeat queries skip the network round-trip.
export async function searchLaw(
  input: { query?: string },
  signal?: AbortSignal,
): Promise<LawToolResult> {
  const q = (input.query ?? "").trim();
  if (!q) return { text: "query(정식 법률명)가 필요합니다.", lawName: "", article: "" };
  const entry = await resolveMst(q, signal);
  if (!entry)
    return {
      text: `NOT_FOUND: "${q}" 법령을 찾지 못했습니다. 정식 법률명(예: 소득세법, 부가가치세법)으로 다시 검색하십시오.`,
      lawName: "",
      article: "",
    };
  return { text: `법령명: ${entry.lawName}\nMST: ${entry.mst}`, lawName: entry.lawName, article: "" };
}

// get_law_text: MST(또는 법령명) + 조문번호 → 조문 전문.
export async function getLawText(
  input: { mst?: string; lawName?: string; jo?: string },
  signal?: AbortSignal,
): Promise<LawToolResult> {
  let mst = input.mst;
  let lawName = (input.lawName ?? "").trim();
  const joLabel = (input.jo ?? "").trim();

  if (!mst && lawName) {
    const e = await resolveMst(lawName, signal);
    if (e) { mst = e.mst; lawName = e.lawName; }
  }
  if (!mst) return { text: "mst 또는 lawName이 필요합니다.", lawName, article: joLabel };

  const joCode = joLabel ? buildJO(joLabel) : "";
  const url = `${LAW_API_BASE}/lawService.do?OC=${apiKey()}&target=eflaw&type=JSON&MST=${mst}${joCode ? `&JO=${joCode}` : ""}`;
  const res = await fetch(url, { signal });
  const json = await res.json();

  const lawData = json?.법령;
  if (!lawData) return { text: "조문 데이터를 찾을 수 없습니다.", lawName, article: joLabel };

  const basicInfo = lawData.기본정보 || {};
  const canonicalName: string = basicInfo.법령명_한글 || basicInfo.법령명한글 || lawName;
  const effDate: string = basicInfo.시행일자 || basicInfo.최종시행일자 || "";

  const units = normalizeItems<Record<string, unknown>>(
    lawData.조문?.조문단위 as Record<string, unknown> | Record<string, unknown>[] | undefined,
  ).filter((u) => {
    const kind = u.조문여부 as string | undefined;
    return !kind || kind === "조문";
  });

  const body = units
    .map((u) => {
      const joNum = typeof u.조문번호 === "string" ? parseJO(u.조문번호) : String(u.조문번호 ?? "");
      const title = String(u.조문제목 ?? "");
      const content = String(u.조문내용 ?? "");
      const clauses = normalizeItems<Record<string, unknown>>(u.항 as never)
        .map((h) => {
          const hangText = String(h.항내용 ?? "").trim();
          const ho = normalizeItems<Record<string, unknown>>(h.호 as never)
            .map((x) => String(x.호내용 ?? "").trim())
            .filter(Boolean)
            .join("\n");
          return [hangText, ho].filter(Boolean).join("\n");
        })
        .filter(Boolean)
        .join("\n");
      const head = `${joNum}${title ? ` (${title})` : ""}`;
      return [head, content, clauses].filter(Boolean).join("\n");
    })
    .join("\n\n")
    .trim();

  const text = body
    ? `[${canonicalName}${effDate ? ` · 시행 ${effDate}` : ""}]\n${body}`
    : `[${canonicalName}] 해당 조문 본문을 찾지 못했습니다.`;

  return { text, lawName: canonicalName, article: joLabel };
}

// Anthropic tool definitions — only the two tools the flow actually uses,
// instead of the 50+ the MCP server exposed (which bloated every model call).
export const LAW_TOOLS = [
  {
    name: "search_law",
    description:
      "정식 법률명으로 법령을 검색하여 MST(법령일련번호)를 반환합니다. query에는 '소득세법', '부가가치세법', '법인세법' 같은 정식 법률명만 넣으십시오. '원천징수' 같은 키워드는 NOT_FOUND가 됩니다.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "정식 법률명" } },
      required: ["query"],
    },
  },
  {
    name: "get_law_text",
    description:
      "MST와 조문번호로 조문 전문을 조회합니다. search_law로 얻은 mst와 '제27조' 형식의 jo를 함께 넣으십시오. mst를 모르면 lawName(정식 법률명)을 넣어도 됩니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        mst: { type: "string", description: "search_law로 얻은 MST(법령일련번호)" },
        lawName: { type: "string", description: "정식 법률명 (mst를 모를 때 사용)" },
        jo: { type: "string", description: "조문번호, 예: 제27조, 제39조의2" },
      },
      required: ["jo"],
    },
  },
];

export async function callLawTool(
  name: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<LawToolResult> {
  if (name === "search_law") return searchLaw(input as { query?: string }, signal);
  if (name === "get_law_text") return getLawText(input as { mst?: string; lawName?: string; jo?: string }, signal);
  return { text: `알 수 없는 도구: ${name}`, lawName: "", article: "" };
}
