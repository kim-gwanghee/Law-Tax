#!/usr/bin/env node
// embed-corpus.mjs — second build step after build-prec-corpus.mjs.
//
// Reads data/prec-corpus.json, embeds each precedent's headnote
// (사건명 + 판시사항 + 판결요지) with a LOCAL transformers.js model, and writes a
// lean runtime index data/prec-index.json that lib/prec-search.ts loads in-process.
// 판례내용(전문) is intentionally left out of the index to keep it small.
//
// Re-runnable: only embeds cases not already present in the index.
//
// Run (no API key needed — model is pulled from the HF Hub on first run + cached):
//   node scripts/embed-corpus.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline, env } from "@xenova/transformers";

env.allowLocalModels = false; // fetch the model from the HF Hub, then cache it

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(ROOT, "data", "prec-corpus.json");
const INDEX = path.join(ROOT, "data", "prec-index.json");

// multilingual-e5-small: 384-dim, strong Korean retrieval, ~120MB quantized.
// E5 models REQUIRE input prefixes — "passage: " for indexed docs, "query: " for
// search queries. lib/prec-search.ts MUST embed queries with this same model and
// the "query: " prefix, or cosine scores are meaningless. Keep the two in sync.
const MODEL = "Xenova/multilingual-e5-small";
const BATCH = 16;
const MAX_CHARS = 1800; // model truncates at 512 tokens anyway; caps tokenization cost

// Embedding text per case: title + the two compressed-holding fields, e5-prefixed.
function embedText(c) {
  return "passage: " + [c.사건명, c.판시사항, c.판결요지].filter(Boolean).join("\n").slice(0, MAX_CHARS);
}

let extractor;
async function embedBatch(texts) {
  extractor ??= await pipeline("feature-extraction", MODEL);
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  return out.tolist(); // → number[][] of shape [texts.length][384]
}

function loadIndex() {
  if (!fs.existsSync(INDEX)) return new Map();
  return new Map(JSON.parse(fs.readFileSync(INDEX, "utf8")).map((r) => [r.id, r]));
}
function saveIndex(map) {
  fs.writeFileSync(INDEX, JSON.stringify([...map.values()]));
}

async function main() {
  if (!fs.existsSync(CORPUS)) throw new Error(`코퍼스 없음: ${CORPUS} — 먼저 build-prec-corpus.mjs 실행`);
  const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
  const index = loadIndex();
  const todo = corpus.filter((c) => !index.has(c.id));
  console.log(`코퍼스 ${corpus.length}건 · 기존 인덱스 ${index.size}건 · 신규 임베딩 ${todo.length}건`);

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const vecs = await embedBatch(chunk.map(embedText));
    chunk.forEach((c, k) => {
      index.set(c.id, {
        id: c.id,
        사건명: c.사건명, 사건번호: c.사건번호, 선고일자: c.선고일자,
        판시사항: c.판시사항, 판결요지: c.판결요지, 참조조문: c.참조조문,
        embedding: vecs[k],
      });
    });
    saveIndex(index); // checkpoint each batch
    process.stdout.write(`  임베딩 ${Math.min(i + BATCH, todo.length)}/${todo.length}\r`);
  }
  console.log(`\n완료 · 인덱스 총 ${index.size}건 → ${path.relative(ROOT, INDEX)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
