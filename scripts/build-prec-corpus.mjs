#!/usr/bin/env node
// build-prec-corpus.mjs — one-off crawler for the precedent (판례) layer.
//
// Pulls Supreme Court (데이터출처명='대법원') tax precedents from the law.go.kr
// DRF API and writes a JSON corpus of headnotes (판시사항 + 판결요지 + 참조조문)
// for later embedding. Only 대법원-sourced items are kept because NTS-sourced
// (국세법령정보시스템) items return "일치하는 판례 없음" on the DRF detail call —
// their bodies are not fetchable here.
//
// Re-runnable / resumable: detail results already in the corpus are skipped, so a
// flaky law.go.kr run can just be re-invoked.
//
// Run:
//   node scripts/build-prec-corpus.mjs              # full crawl (seeds × 3 pages)
//   MAX_PAGES=1 MAX_CASES=10 node scripts/build-prec-corpus.mjs   # quick smoke test
//
// Env: LAW_API_KEY (OC). Auto-loaded from .env.local if not already exported.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "prec-corpus.json");
const BASE = "https://www.law.go.kr/DRF";

// ── env ───────────────────────────────────────────────────────────────────
// OC = law.go.kr 등록 ID. Normally injected into the shell by ~/.zshrc sourcing
// global.env, so process.env.LAW_API_KEY is set. Falls back to .env.local lines.
function loadOC() {
  if (process.env.LAW_API_KEY) return process.env.LAW_API_KEY.trim();
  const envPath = path.join(ROOT, ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      if (/^\s*#/.test(line)) continue; // skip comments
      const m = line.match(/^\s*LAW_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  throw new Error(
    "LAW_API_KEY 미설정. 다음처럼 실행하세요:\n" +
    "  set -a; source /Users/imsi/Documents/Side-Projects/global.env; set +a\n" +
    "  node scripts/build-prec-corpus.mjs",
  );
}
const OC = loadOC();

const MAX_PAGES = Number(process.env.MAX_PAGES ?? 3); // search pages per keyword (×100)
const MAX_CASES = Number(process.env.MAX_CASES ?? Infinity); // cap on NEW detail fetches
const DELAY = Number(process.env.DELAY_MS ?? 300); // politeness delay between calls

// Body-text search (search=2) also matches the keyword inside 민사/형사/가사 rulings
// (e.g. "신의성실의 원칙", "명의신탁" are general civil-law doctrines). Keep only
// tax-domain case types so the corpus isn't polluted with off-domain precedents.
// 조세 행정소송 is filed as 일반행정, so both are kept.
const TAX_TYPES = new Set(["세무", "일반행정"]);

// ── seed keywords (full-text search). Trim/extend freely — grouped by axis. ──
const SEEDS = {
  법리: ["실질과세", "명의신탁", "차명계좌", "부당행위계산부인", "특수관계인",
        "신의성실의 원칙", "소급과세", "가공세금계산서", "사실과 다른 세금계산서",
        "매입세액공제", "의제배당", "제2차 납세의무"],
  절차: ["부과제척기간", "가산세", "무신고가산세", "경정청구", "과세전적부심사",
        "심판청구", "납세고지", "사해행위취소", "체납처분"],
  양도세: ["1세대 1주택", "일시적 2주택", "장기보유특별공제", "부담부증여",
         "취득가액 환산", "이월과세"],
  상증세: ["완전포괄주의", "가업상속공제", "증여추정", "저가양도", "비상장주식 평가",
         "일감몰아주기"],
  법인세: ["손금불산입", "기업업무추진비", "대손금", "가지급금 인정이자",
         "감가상각", "이월결손금"],
  부가세: ["영세율", "면세사업", "간주공급", "사업자등록", "세금계산서"],
  소득세: ["사업소득", "기타소득", "금융소득종합과세", "비거주자", "원천징수"],
};
const ALL = [...new Set(Object.values(SEEDS).flat())];

// ── helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// law.go.kr wraps some fields in CDATA and embeds <br/> + HTML entities. Strip all.
function clean(s) {
  return s
    .replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&") // must run last
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function pick(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? clean(m[1]) : "";
}

// Fetch with retry. law.go.kr intermittently serves an HTML error page instead of
// XML — only accept a real XML document (starts with <?xml).
async function getXml(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      const t = await res.text();
      // Auth / IP-whitelist failure comes back as a 200 with <Response> — fail loud
      // so we never silently build an empty corpus.
      if (t.includes("사용자 정보 검증에 실패") || /<result>.*실패.*<\/result>/.test(t)) {
        throw new Error(`law.go.kr 인증 실패 (OC/IP 화이트리스트 확인 필요):\n${t.slice(0, 260)}`);
      }
      if (t.trim().startsWith("<?xml")) return t;
    } catch (e) {
      if (e.message?.includes("인증 실패")) throw e; // do not retry auth errors
      /* network blip — retry */
    }
    await sleep(1000 * (i + 1)); // 1s, 2s, 3s — back off through rate-limit bursts
  }
  return null;
}

// ── phase 1: collect unique 대법원 precedent IDs across all seed keywords ──────
async function collectIds() {
  const byId = new Map(); // id -> { meta..., seeds:Set<string> }
  for (const kw of ALL) {
    let kwHits = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE}/lawSearch.do?OC=${OC}&target=prec&type=XML&search=2`
        + `&query=${encodeURIComponent(kw)}&display=100&page=${page}&sort=ddes`;
      const xml = await getXml(url);
      if (!xml) break;
      const items = [...xml.matchAll(/<prec\b[^>]*>([\s\S]*?)<\/prec>/g)].map((m) => m[1]);
      if (items.length === 0) break;
      for (const it of items) {
        if (pick(it, "데이터출처명") !== "대법원") continue; // only fetchable bodies
        const 사건종류명 = pick(it, "사건종류명");
        if (!TAX_TYPES.has(사건종류명)) continue; // drop 민사/형사/가사/특허 noise
        const id = pick(it, "판례일련번호");
        if (!id) continue;
        const rec = byId.get(id) ?? {
          id,
          사건명: pick(it, "사건명"), 사건번호: pick(it, "사건번호"),
          선고일자: pick(it, "선고일자"), 법원명: pick(it, "법원명"),
          사건종류명, seeds: new Set(),
        };
        rec.seeds.add(kw);
        byId.set(id, rec);
        kwHits++;
      }
      if (items.length < 100) break;
      await sleep(DELAY);
    }
    console.log(`[수집] ${kw.padEnd(16)} +${String(kwHits).padStart(3)} 대법원건 · unique 누적 ${byId.size}`);
  }
  return byId;
}

// ── corpus I/O (resumable) ───────────────────────────────────────────────────
function loadCorpus() {
  if (!fs.existsSync(OUT)) return new Map();
  return new Map(JSON.parse(fs.readFileSync(OUT, "utf8")).map((r) => [r.id, r]));
}
function saveCorpus(map) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify([...map.values()], null, 2));
}

// ── phase 2: fetch detail (판시사항/판결요지/참조조문) for each unique ID ───────
async function main() {
  console.log(`OC=${OC} · seeds=${ALL.length} · MAX_PAGES=${MAX_PAGES} · MAX_CASES=${MAX_CASES}\n`);
  const byId = await collectIds();
  const corpus = loadCorpus();
  // One-time cleanup: drop non-tax entries left by an earlier unfiltered crawl.
  let pruned = 0;
  for (const [id, r] of corpus) {
    if (!TAX_TYPES.has(r.사건종류명)) { corpus.delete(id); pruned++; }
  }
  if (pruned) { saveCorpus(corpus); console.log(`정리: 비세무 ${pruned}건 제거`); }
  console.log(`\n세무 대법원 고유 판례 ${byId.size}건 수집 · 기존 코퍼스 ${corpus.size}건\n`);

  const ids = [...byId.keys()];
  let fetched = 0, skipped = 0, failed = 0, n = 0;
  for (const id of ids) {
    if (corpus.has(id)) { skipped++; continue; }
    if (fetched >= MAX_CASES) break;
    n++;
    const xml = await getXml(`${BASE}/lawService.do?OC=${OC}&target=prec&ID=${id}&type=XML`);
    const 판시사항 = xml ? pick(xml, "판시사항") : "";
    const 판결요지 = xml ? pick(xml, "판결요지") : "";
    if (!판시사항 && !판결요지) { failed++; await sleep(DELAY); continue; } // not-found / blip
    const meta = byId.get(id);
    corpus.set(id, {
      id,
      사건명: pick(xml, "사건명") || meta.사건명,
      사건번호: pick(xml, "사건번호") || meta.사건번호,
      선고일자: pick(xml, "선고일자") || meta.선고일자,
      법원명: pick(xml, "법원명") || meta.법원명 || "대법원",
      사건종류명: pick(xml, "사건종류명") || meta.사건종류명,
      판시사항, 판결요지,
      참조조문: pick(xml, "참조조문"),
      참조판례: pick(xml, "참조판례"),
      판례내용: pick(xml, "판례내용"),
      seeds: [...meta.seeds],
    });
    fetched++;
    if (fetched % 20 === 0) saveCorpus(corpus); // checkpoint
    process.stdout.write(`  상세 ${n}/${ids.length} · 신규 ${fetched} · 실패 ${failed}\r`);
    await sleep(DELAY);
  }
  saveCorpus(corpus);
  console.log(`\n\n완료 · 신규 ${fetched} · 스킵(기존) ${skipped} · 실패 ${failed} · 코퍼스 총 ${corpus.size}건`);
  console.log(`→ ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
