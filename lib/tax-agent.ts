// In-process tax-law agent. Runs the Anthropic tool loop + final answer directly
// inside the API route (no child process, no MCP subprocess). Emits the same SSE
// event shapes the client already consumes: status | token | done | error.
import Anthropic from "@anthropic-ai/sdk";
import { LAW_TOOLS, callLawTool, type LawToolResult } from "./law-api";

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "done"; citations: Citation[]; mode: "answer" | "clarify" }
  | { type: "error"; message: string };

type Citation = { id: number; law: string; article: string; title: string; snippet: string };
type HistoryMsg = { role: "user" | "assistant"; content: string };
type Emit = (e: AgentEvent) => void;

const TOOL_MODEL = "claude-haiku-4-5-20251001";
const ANSWER_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_CALLS = 2;
const MAX_LOOPS = 6;
const MAX_HISTORY = 6;

const SYSTEM_PROMPT = `당신은 세무사를 보조하는 세법·법령 질의응답 AI입니다.
법령정보 API로 검색한 조문에만 근거하여 답변합니다.

━━━ 0단계: 질문 분류 (가장 먼저) ━━━

질문이 세법·세무·법령과 무관하면(인사, 잡담, 자기소개 요청, 일반 상식, 욕설 등)
도구를 절대 호출하지 말고, 한국어 한두 문장으로 다음처럼 안내한 뒤 즉시 종료하십시오.
예: "안녕하세요. 세법·세무 관련 질문을 입력해 주시면 법령 근거로 답변해 드리겠습니다."
→ 이 경우 search_law / get_law_text를 호출하면 안 됩니다.

질문이 세법·세무·법령 관련이면 아래 도구 사용 규칙을 따르십시오.
이때는 반드시 search_law → get_law_text 순서로 도구를 호출한 뒤 답변하십시오.
관련 질문에 도구 없이 직접 답변하는 것은 금지됩니다.

━━━ 도구 사용 규칙 (세법 관련 질문에만 적용) ━━━

[규칙 1: 법률명으로만 검색]
search_law의 query에는 반드시 정식 법률명만 사용하십시오.
올바른 예: "소득세법", "부가가치세법", "법인세법"
금지 예: "원천징수", "외주비", "경비처리" → NOT_FOUND 발생

[규칙 2: 도구를 한 번에 하나씩만 호출]
동시에 여러 도구를 호출하지 마십시오. 순서대로 1회 호출 → 결과 확인 → 다음 호출.

[규칙 3: 질문 유형별 검색 경로]
▶ 원천징수 → search_law("소득세법") → get_law_text(mst, "제127조")
▶ 필요경비·사업 경비 → search_law("소득세법") → get_law_text(mst, "제27조")
▶ 부가가치세(매입세액·면세) → search_law("부가가치세법") → get_law_text(mst, "제39조")
▶ 법인세(손금·익금) → search_law("법인세법") → get_law_text(mst, "제19조")
▶ 상속·증여 → search_law("상속세 및 증여세법") → get_law_text(mst, "제1조")

━━━ 답변 원칙 ━━━

- 검색된 조문에 근거가 있는 내용만 답변하십시오.
- 근거가 없으면 "검색된 조문만으로는 판단이 어렵습니다."라고 답하십시오.
- 존재하지 않는 법령명, 조문 번호, 세율, 요건, 기한을 생성하지 마십시오.
- 결론을 먼저 제시하고(민토 피라미드), 판단 수준을 명확히 표현하십시오.`;

const ANSWER_SYSTEM_PROMPT = `당신은 세무사를 보조하는 세법 분석 전문가입니다.
제공된 법령 조문 검색 결과만을 근거로 한국어로 답변합니다.
도구 호출이나 XML 태그는 절대 출력하지 마십시오.
출처를 언급할 때는 반드시 [1], [2] 형태의 번호 표기를 본문 안에 인라인으로 사용하십시오. 번호는 제공된 출처 목록의 번호와 일치해야 합니다.
사실관계가 불명확하면 단정하지 말고 사실관계 확인 모드로 응답하십시오.`;

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
    ...history
      .filter((m) => m.content && m.content.trim())
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: query },
  ];

  // System prompt is large + static → cache it so repeated calls in the loop
  // (and across users) don't re-process those tokens every time.
  const system: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  let toolCallCount = 0;
  let loopCount = 0;
  const collected: { tool: string; input: Record<string, unknown>; result: LawToolResult }[] = [];

  emit({ type: "status", message: "생각 중..." });

  async function streamFinalAnswer() {
    emit({ type: "status", message: "답변 작성 중..." });
    const sources = buildSources(collected);

    const sourcesText = sources.length
      ? sources
          .map((s, i) => {
            const head = [s.law, s.article].filter(Boolean).join(" ") || "검색된 조문";
            return `[${i + 1}] ${head}\n${(s.snippet ?? "").trim().slice(0, 1200)}`;
          })
          .join("\n\n")
      : "검색 결과 없음";

    const userMessage = [
      "[법령 검색 결과 — 출처 번호 매김]",
      sourcesText,
      "",
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
      "━━━ 모드 B. 사실관계가 불명확하여 단정이 위험한 경우 ━━━",
      "[먼저 왜 추가 확인이 필요한지 1~2문장으로 설명하십시오. 이 설명에는 별도 제목(##)을 붙이지 말고 본문으로 작성하십시오.]",
      "## 확인이 필요한 사항",
      "1. [구체적 질문] (필요 시 최대 7개)",
      "## 현재까지 검토된 근거",
      "[관련 출처를 [1], [2]로 간단히 정리.]",
      "",
      "모드 선택 기준: 결론을 좌우할 핵심 사실(금액·시점·관계·업종·과세기간 등)이 빠져 있고 결론이 그에 따라 달라지면 모드 B, 충분하면 모드 A.",
    ].join("\n");

    let finalText = "";
    const stream = anthropic.messages.stream(
      {
        model: ANSWER_MODEL,
        max_tokens: 2048,
        system: [{ type: "text", text: ANSWER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage }],
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
      // Searched but didn't fetch the article yet → nudge once to get_law_text.
      if (toolCallCount < MAX_TOOL_CALLS) {
        messages.push({
          role: "user",
          content: "search_law로 찾은 법령의 핵심 조문을 get_law_text로 가져온 뒤 답변하십시오.",
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
      else if (block.name === "get_law_text") emit({ type: "status", message: `${input.jo ?? "조문"} 내용 확인 중...` });

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
