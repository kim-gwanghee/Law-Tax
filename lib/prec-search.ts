// In-process precedent (판례) retrieval over the prebuilt embedding index at
// data/prec-index.json (produced by scripts/embed-corpus.mjs). Embeds the query
// with OpenAI text-embedding-3-small and returns the top-k 대법원 precedents by
// cosine similarity. Brute-force over ~1-2k vectors is sub-millisecond, so there
// is no vector DB at this corpus size. The Fly app is always-on, so the index is
// loaded once into module memory and reused across requests.
import fs from "node:fs";
import path from "node:path";
import { pipeline, env } from "@xenova/transformers";

env.allowLocalModels = false; // pull the model from the HF Hub on first use, then cache

type IndexEntry = {
  id: string;
  사건명: string; 사건번호: string; 선고일자: string;
  판시사항: string; 판결요지: string; 참조조문: string;
  embedding: number[];
};

export type PrecedentHit = {
  id: string;
  사건명: string; 사건번호: string; 선고일자: string;
  판시사항: string; 판결요지: string; 참조조문: string;
  score: number;
};

// Must match scripts/embed-corpus.mjs (same model + e5 prefixes), or the query
// vector lives in a different space than the index and cosine scores are garbage.
const EMBED_MODEL = "Xenova/multilingual-e5-small";

let INDEX: IndexEntry[] | null = null;

function loadIndex(): IndexEntry[] {
  if (INDEX) return INDEX;
  const file = path.join(process.cwd(), "data", "prec-index.json");
  try {
    INDEX = JSON.parse(fs.readFileSync(file, "utf8")) as IndexEntry[];
  } catch {
    INDEX = []; // index not built / not deployed → retrieval becomes a no-op
  }
  return INDEX;
}

// Lazy singleton — the model loads once per process (~seconds on cold start), then
// each query embed is ~50-150ms on CPU. The app is long-running, so it stays warm.
type Extractor = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;
let extractorPromise: Promise<Extractor> | null = null;
function getExtractor(): Promise<Extractor> {
  extractorPromise ??= pipeline("feature-extraction", EMBED_MODEL) as unknown as Promise<Extractor>;
  return extractorPromise;
}

async function embedQuery(query: string): Promise<number[] | null> {
  const extractor = await getExtractor();
  const out = await extractor("query: " + query, { pooling: "mean", normalize: true });
  return out.tolist()[0] ?? null;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Top-k precedents above minScore, most-similar first. Returns [] (never throws)
// when the index is missing, OPENAI_API_KEY is unset, or embedding fails — so the
// caller degrades to a law-only answer instead of erroring.
export async function searchPrecedents(
  query: string,
  // e5 cosine scores are compressed into a narrow high band (corpus background
  // ~0.83, clearly-relevant 0.86–0.92), so ranking carries the signal and the
  // floor is just a safety net to drop weak matches. Tuned on real tax queries.
  { topK = 3, minScore = 0.85 }: { topK?: number; minScore?: number; signal?: AbortSignal } = {},
): Promise<PrecedentHit[]> {
  try {
    const index = loadIndex();
    if (index.length === 0) return [];
    const qvec = await embedQuery(query);
    if (!qvec) return [];
    return index
      .map((e) => ({ e, score: cosine(qvec, e.embedding) }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ e, score }) => ({
        id: e.id, 사건명: e.사건명, 사건번호: e.사건번호, 선고일자: e.선고일자,
        판시사항: e.판시사항, 판결요지: e.판결요지, 참조조문: e.참조조문, score,
      }));
  } catch {
    return [];
  }
}
