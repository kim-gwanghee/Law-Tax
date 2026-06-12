// In-process tax-law agent. Runs the Anthropic tool loop + final answer directly
// inside the API route (no child process, no MCP subprocess). Emits the same SSE
// event shapes the client already consumes: status | token | done | error.
import Anthropic from "@anthropic-ai/sdk";
import { LAW_TOOLS, callLawTool, type LawToolResult } from "./law-api";
import { searchPrecedents } from "./prec-search";
import { priorTurns, type HistoryMsg } from "./history";

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "done"; citations: Citation[]; mode: "answer" | "clarify" }
  | { type: "error"; message: string };

type Citation = { id: number; law: string; article: string; title: string; snippet: string };
type Emit = (e: AgentEvent) => void;

const TOOL_MODEL = "claude-haiku-4-5-20251001";
// RAG answer: the law text is already retrieved, so the answer model only structures
// it. Haiku is fast and sufficient here — measured Sonnet answer phase was ~14s (68%
// of total latency). Switching to Haiku targets ~5-7s.
const ANSWER_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_CALLS = 5; // hard cap; lets the model fetch several relevant articles
const MAX_LOOPS = 10;

const SYSTEM_PROMPT = `당신은 세무사를 보조하는 세법·법령 질의응답 AI입니다.
법령정보 API로 검색한 조문에만 근거하여 답변합니다.

━━━ 0단계: 질문 분류 (가장 먼저) ━━━

질문이 세법·세무·법령과 무관하면(인사, 잡담, 자기소개 요청, 일반 상식, 욕설 등)
도구를 절대 호출하지 말고, 한국어 한두 문장으로 다음처럼 안내한 뒤 즉시 종료하십시오.
예: "안녕하세요. 세법·세무 관련 질문을 입력해 주시면 법령 근거로 답변해 드리겠습니다."
→ 이 경우 search_law / get_law_text를 호출하면 안 됩니다.

질문이 세법·세무·법령 관련이면 아래 도구 사용 규칙을 따르십시오.
반드시 조문 본문을 get_law_text로 가져온 뒤 답변하십시오. 도구 없이 직접 답변하는 것은 금지됩니다.

━━━ 도구 사용 규칙 (세법 관련 질문에만 적용) ━━━

[규칙 1: 법률명을 알면 search_law 생략]
정식 법률명을 아는 경우 search_law를 호출하지 말고 get_law_text(lawName, jo)를 바로 호출하십시오. (속도 향상)
search_law는 법률명이 불확실하거나 어느 법인지 모를 때만 사용하십시오.
get_law_text의 lawName/search_law의 query에는 반드시 정식 법률명만 사용하십시오. (예: "소득세법". "원천징수"·"경비처리" 같은 키워드 금지)

[규칙 2: 도구를 한 번에 하나씩만 호출]
동시에 여러 도구를 호출하지 마십시오. 순서대로 1회 호출 → 결과 확인 → 다음 호출.

[규칙 3: 질문 유형별 경로 (법률명을 알면 바로 get_law_text)]
▶ 원천징수 → get_law_text(lawName="소득세법", jo="제127조")
▶ 필요경비·사업 경비·주거비·임차료(월세)·업무용 자산 → get_law_text(lawName="소득세법", jo="제27조") (필요경비 일반요건: 업무관련성·통상성)
▶ 부가가치세(매입세액·면세) → get_law_text(lawName="부가가치세법", jo="제39조")
▶ 법인세(손금·익금) → get_law_text(lawName="법인세법", jo="제19조")
▶ 상속·증여 → get_law_text(lawName="상속세 및 증여세법", jo="제1조")

[규칙 4: 쟁점이 여러 조문에 걸치면 추가 조회]
한 조문만으로 결론 근거가 부족하면, get_law_text를 2~3개 조문까지 추가로 호출해 충분한 근거를 확보한 뒤 답변하십시오. (예: 필요경비 일반요건 + 관련 불산입 조문)

━━━ 답변 원칙 ━━━

- 검색된 조문에 근거가 있는 내용만 답변하십시오.
- 근거가 없으면 "검색된 조문만으로는 판단이 어렵습니다."라고 답하십시오.
- 존재하지 않는 법령명, 조문 번호, 세율, 요건, 기한을 생성하지 마십시오.
- 결론을 먼저 제시하고(민토 피라미드), 판단 수준을 명확히 표현하십시오.`;

const ANSWER_SYSTEM_PROMPT = `당신은 세무사를 보조하는 세법 분석 전문가입니다.
제공된 법령 조문 검색 결과만을 근거로 한국어로 답변합니다.
도구 호출이나 XML 태그는 절대 출력하지 마십시오.
출처를 언급할 때는 반드시 [1], [2] 형태의 번호 표기를 본문 안에 인라인으로 사용하십시오. 번호는 제공된 출처 목록의 번호와 일치해야 합니다.
세법 답변은 본질적으로 조건부입니다. 사실관계가 일부 불명확해도 가능한 한 '요건별 조건부 결론'으로 답하고, 추가 질문(확인 모드)은 핵심 사실이 거의 없어 어떤 조건부 결론도 세울 수 없을 때만 최소한으로 사용하십시오.
답변은 간결하게 작성하십시오. 핵심만 담고 같은 내용의 반복·장황한 부연을 피하며, 각 섹션은 필요한 분량만 사용하십시오.`;

function textOf(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// One citation per get_law_text result. search_law results are context only.
function buildSources(collected: { tool: string; input: Record<string, unknown>; result: LawToolResult }[]) {
  const sources: { law: string; article: string; title: string; snippet: string }[] = [];
  for (const r of collected) {
    if (r.tool !== "get_law_text") continue;
    const law = r.result.lawName || String(r.input.lawName ?? "");
    const article = r.result.article || String(r.input.jo ?? "");
    const title = [law, article].filter(Boolean).join(" ").trim() || "법령 조문";
    sources.push({ law, article, title, snippet: r.result.text });
  }
  return sources;
}

function pickCitedSources(
  text: string,
  sources: { law: string; article: string; title: string; snippet: string }[],
): Citation[] {
  const used = new Set<number>();
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < sources.length) used.add(idx);
  }
  const idxs = used.size === 0 ? sources.map((_, i) => i) : [...used].sort((a, b) => a - b);
  return idxs.map((i) => ({ id: i + 1, ...sources[i] }));
}

export async function runTaxQuery({
  query,
  history = [],
  emit,
  signal,
}: {
  query: string;
  history?: HistoryMsg[];
  emit: Emit;
  signal?: AbortSignal;
}): Promise<void> {
  // Bump retries above the SDK default (2) to ride out transient 429/529/network
  // blips from the Anthropic API, a likely source of intermittent 500s.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });

  const messages: Anthropic.Messages.MessageParam[] = [
    ...priorTurns(history),
    { role: "user" as const, content: query },
  ];

  // System prompt is large + static → cache it so repeated calls in the loop
  // (and across users) don't re-process those tokens every time.
  const system: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  let toolCallCount = 0;
  let loopCount = 0;
  let gotLawText = false; // require at least one get_law_text before answering (grounding)
  const collected: { tool: string; input: Record<string, unknown>; result: LawToolResult }[] = [];

  // Anti-loop: if the previous assistant turn already asked clarifying questions,
  // do not clarify again — commit to a conditional answer with the facts at hand.
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  const priorWasClarify = !!lastAssistant?.content && /##\s*확인이 필요한 사항/.test(lastAssistant.content);

  const startedAt = Date.now(); // for tool-phase vs answer-phase timing

  emit({ type: "status", message: "생각 중..." });

  async function streamFinalAnswer() {
    const toolMs = Date.now() - startedAt; // time spent in search/get_law_text loop
    const answerStart = Date.now();
    const lawSources = buildSources(collected);

    // Augment law articles with semantically-retrieved 대법원 판례. Graceful no-op
    // (returns []) if the index isn't built/deployed, OPENAI_API_KEY is missing, or
    // embedding fails — so the answer degrades to law-only instead of erroring.
    // Shaped exactly like law sources so the existing [n] citation numbering and
    // client rendering work unchanged; precedent heads read "대법원 <사건번호>".
    emit({ type: "status", message: "관련 판례 검색 중..." });
    const precHits = await searchPrecedents(query, { topK: 3, signal });
    const precSources = precHits.map((h) => ({
      law: "대법원",
      article: h.사건번호,
      title: h.사건명,
      snippet: `[판시사항] ${h.판시사항}\n[판결요지] ${h.판결요지.slice(0, 800)}`,
    }));
    const sources = [...lawSources, ...precSources];

    emit({ type: "status", message: "답변 작성 중..." });
    const sourcesText = sources.length
      ? sources
          .map((s, i) => {
            const head = [s.law, s.article].filter(Boolean).join(" ") || "검색된 조문";
            return `[${i + 1}] ${head}\n${(s.snippet ?? "").trim().slice(0, 1200)}`;
          })
          .join("\n\n")
      : "검색 결과 없음";

    const userMessage = [
      "[근거 자료 — 출처 번호 매김]",
      "(출처 중 '대법원 <사건번호>'로 시작하는 항목은 판례입니다. 법령 조문을 1차 근거로 삼고, 판례는 법리·해석 보강용으로 [n] 인용하되, 사실관계가 사안과 다를 수 있음을 감안하십시오.)",
      sourcesText,
      "",
      // No sources retrieved this turn — common on follow-ups where the tool model
      // answers from conversation history without re-fetching the article. Without
      // this guard the answer model still emits [1] out of habit, producing a
      // dangling citation marker with no chip behind it. A legal tool must never
      // cite without a real source, so forbid [n] when there is nothing to cite.
      sources.length
        ? ""
        : "⚠ 이번 턴에는 인용 가능한 출처가 없습니다(위 [근거 자료]가 비어 있음). [1], [2] 같은 번호 인용을 절대 사용하지 마십시오. 이전 대화에서 이미 확인된 법령은 번호 없이 '소득세법 제27조'처럼 법령명·조문으로 직접 서술하고, 조문 번호·세율을 새로 지어내지 마십시오.",
      "[질문]",
      query,
      "",
      "위 출처에 근거하여 한국어로 답변하십시오. 아래 두 모드 중 하나를 고르십시오.",
      "",
      "━━━ 모드 A. 사실관계가 충분한 경우 ━━━",
      "## 결론",
      "[핵심 판단 2~3문장. 가능 여부를 명확히. 근거는 [1], [2] 형태로 본문에 인라인 표기.]",
      "## 근거 법령",
      "[출처 번호를 [1], [2]로 표시하고 결론과의 연결을 설명. 조문 핵심을 짧게 인용.]",
      "## 유의사항",
      "[전제 사실관계, 결론이 달라질 수 있는 조건, 추가 확인 필요 사항.]",
      "",
      "━━━ 모드 B. 핵심 사실이 거의 없어 어떤 조건부 결론도 무의미한 경우에만 ━━━",
      "[먼저 왜 추가 확인이 필요한지 1~2문장으로 설명하십시오. 이 설명에는 별도 제목(##)을 붙이지 말고 본문으로 작성하십시오.]",
      "## 확인이 필요한 사항",
      "1. [구체적 질문 — 결론을 가장 크게 좌우하는 것만, 최대 3개]",
      "## 현재까지 검토된 근거",
      "[관련 출처를 [1], [2]로 간단히 정리.]",
      "",
      "━━━ 모드 선택 기준 (중요) ━━━",
      "- 기본값은 모드 A입니다. 세법 답변은 본질적으로 조건부이므로, 사실관계가 일부 불명확해도 '요건별 조건부 결론'(예: ○○ 요건 충족 시 가능 [1], △△인 경우 불가)으로 답하는 것을 우선하십시오.",
      "- 모드 B는 핵심 사실이 거의 없어 어떤 조건부 결론도 세울 수 없을 때만 사용하고, 질문은 최대 3개로 제한하십시오.",
      "- 사용자가 이미 사실관계를 제시했다면, 그 사실을 전제로 모드 A 결론을 작성하고 남은 변수는 '유의사항'에 간단히 적으십시오. 다시 질문으로 되묻지 마십시오.",
      priorWasClarify
        ? "- ⚠ 직전 답변에서 이미 확인 질문을 했습니다. 이번에는 절대 추가 질문(모드 B)을 하지 말고, 사용자가 제공한 사실관계와 검색된 근거로 모드 A 조건부 결론을 반드시 작성하십시오."
        : "",
    ].filter(Boolean).join("\n");

    let finalText = "";
    const stream = anthropic.messages.stream(
      {
        model: ANSWER_MODEL,
        max_tokens: 1024,
        system: [{ type: "text", text: ANSWER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        // Include the prior turns so a follow-up that only adds facts keeps the
        // reference to the original question. Without this the answer model saw
        // only the current query and answered the new facts in a vacuum — the
        // "후속 질문이 안 된다" bug.
        messages: [...priorTurns(history), { role: "user", content: userMessage }],
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        finalText += event.delta.text;
        emit({ type: "token", text: event.delta.text });
      }
    }

    const mode = /##\s*확인이 필요한 사항/.test(finalText) ? "clarify" : "answer";
    console.log(`[query] tools=${toolMs}ms answer=${Date.now() - answerStart}ms`);
    emit({ type: "done", citations: pickCitedSources(finalText, sources), mode });
  }

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    const response = await anthropic.messages.create(
      { model: TOOL_MODEL, max_tokens: 1024, system, messages, tools: LAW_TOOLS },
      { signal },
    );
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      // No tools called on the first decision → off-topic / greeting. The model's
      // own text is the answer. This is the gate that stops greetings from
      // looping through forced searches until timeout.
      if (toolCallCount === 0) {
        emit({ type: "token", text: textOf(response.content) || "세법·세무 관련 질문을 입력해 주시면 법령 근거로 답변해 드리겠습니다." });
        emit({ type: "done", citations: [], mode: "answer" });
        return;
      }
      // No article fetched yet → nudge to get_law_text. Once we have at least one
      // article (grounding), end_turn means the model is satisfied → answer
      // (it may also fetch more articles, up to MAX_TOOL_CALLS).
      if (!gotLawText) {
        messages.push({
          role: "user",
          content: "get_law_text로 관련 조문 본문을 가져온 뒤 답변하십시오. 법률명을 알면 lawName으로 바로 호출하십시오.",
        });
        continue;
      }
      await streamFinalAnswer();
      return;
    }

    if (response.stop_reason !== "tool_use") {
      await streamFinalAnswer();
      return;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolCallCount++;
      const input = block.input as Record<string, unknown>;
      if (block.name === "search_law") emit({ type: "status", message: `${input.query ?? "법령"} 검색 중...` });
      else if (block.name === "get_law_text") {
        gotLawText = true;
        emit({ type: "status", message: `${input.jo ?? "조문"} 내용 확인 중...` });
      }

      // A single flaky tool call (law.go.kr network/parse error) must not crash the
      // whole request. Hand the model an error result so it can still answer from
      // what it has, or ask for clarification, instead of surfacing a 500.
      let result: LawToolResult;
      try {
        result = await callLawTool(block.name, input, signal);
      } catch (e) {
        result = {
          text: `법령 조회 중 오류가 발생했습니다(${(e as Error)?.message ?? "unknown"}). 이 조문 없이 답변하거나, 사실관계 확인이 필요하면 추가 질문을 요청하십시오.`,
          lawName: "",
          article: String(input.jo ?? ""),
        };
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result.text });
      collected.push({ tool: block.name, input, result });
    }

    if (toolCallCount >= MAX_TOOL_CALLS) {
      await streamFinalAnswer();
      return;
    }
    messages.push({ role: "user", content: toolResults });
  }

  emit({ type: "error", message: "법령 검색이 예상보다 오래 걸렸습니다. 다시 시도해 주세요." });
}
