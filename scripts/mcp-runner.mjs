// Standalone Node.js script: runs Claude + local MCP server via stdio
// Emits newline-delimited JSON events: status | token | done | error
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const payload = JSON.parse(process.env.MCP_PAYLOAD);
const { query, history, systemPrompt } = payload;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpBin = path.join(__dirname, "..", "node_modules", "korean-law-mcp", "build", "index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpBin],
  env: { ...process.env, LAW_OC: process.env.LAW_API_KEY },
});

const mcpClient = new Client({ name: "tax-agent", version: "1.0.0" });

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function mcpToolsForAnthropic(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

async function callMcpTool(name, input) {
  const result = await mcpClient.callTool({ name, arguments: input });
  const content = result.content ?? [];
  return content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
}

// Build numbered citation sources from collected tool results.
// Each get_law_text result becomes one citation; search_law results provide context only.
function buildSources(collectedResults) {
  const sources = [];
  for (const r of collectedResults) {
    if (r.tool !== "get_law_text") continue;
    const lawName = r.input?.lawName ?? r.input?.law ?? "";
    const article = r.input?.jo ?? r.input?.article ?? "";
    const title = [lawName, article].filter(Boolean).join(" ").trim() || "법령 조문";
    sources.push({ law: lawName, article, title, snippet: r.result });
  }
  return sources;
}

// Pick out [1], [2] markers that actually appear in the final answer and return them in order.
function pickCitedSources(text, sources) {
  const used = new Set();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < sources.length) used.add(idx);
  }
  if (used.size === 0) return sources.map((s, i) => ({ id: i + 1, ...s }));
  return [...used].sort((a, b) => a - b).map((i) => ({ id: i + 1, ...sources[i] }));
}

// Final answer with a CLEAN context — only query + tool results, no accumulated noise
async function streamFinalAnswer(query, collectedResults) {
  emit({ type: "status", message: "답변 작성 중..." });

  const sources = buildSources(collectedResults);

  // Numbered source block for inline citation.
  // Each entry: [N] 법령명 조문 — 조문 본문(요약).
  const sourcesText = sources.length
    ? sources
        .map((s, i) => {
          const head = [s.law, s.article].filter(Boolean).join(" ") || "검색된 조문";
          const body = (s.snippet ?? "").trim().slice(0, 1200);
          return `[${i + 1}] ${head}\n${body}`;
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
    "위 출처에 근거하여 한국어로 답변하십시오. 답변 시 반드시 아래 두 모드 중 하나를 골라 작성하십시오.",
    "",
    "━━━ 모드 A. 사실관계가 충분한 경우 ━━━",
    "다음 3개 섹션 형식으로 답변하십시오.",
    "",
    "## 결론",
    "[핵심 판단을 2~3문장으로. 가능 여부를 명확히 표현하십시오. 근거를 언급할 때는 위 출처 번호를 [1], [2] 형태로 본문 안에 인라인으로 표기하십시오.]",
    "",
    "## 근거 법령",
    "[출처 번호를 [1], [2] 형태로 표시하고 결론과의 연결을 설명하십시오. 조문 핵심 내용을 짧게 인용하십시오.]",
    "",
    "## 유의사항",
    "[전제 사실관계, 결론이 달라질 수 있는 조건, 추가 확인 필요 사항.]",
    "",
    "━━━ 모드 B. 사실관계가 불명확하여 단정 답변이 위험한 경우 ━━━",
    "결론을 추측하지 말고 아래 형식으로 추가 질문을 요청하십시오.",
    "",
    "## 사실관계 확인 필요",
    "[왜 추가 확인이 필요한지 1~2문장으로 설명하십시오.]",
    "",
    "## 확인이 필요한 사항",
    "1. [구체적 질문 1]",
    "2. [구체적 질문 2]",
    "3. [구체적 질문 3]",
    "(필요 시 최대 7개까지)",
    "",
    "## 현재까지 검토된 근거",
    "[검색된 출처 중 관련성이 있는 항목을 [1], [2] 형태로 간단히 정리.]",
    "",
    "모드 선택 기준: 질문에서 결론을 좌우할 핵심 사실(금액·시점·관계·업종·과세기간 등)이 빠져 있고, 결론이 그 사실에 따라 달라진다면 모드 B를 사용하십시오. 핵심 사실이 충분히 제시되어 있으면 모드 A를 사용하십시오.",
  ].join("\n");

  const answerSystemPrompt = `당신은 세무사를 보조하는 세법 분석 전문가입니다.
제공된 법령 조문 검색 결과만을 근거로 한국어로 답변합니다.
도구 호출이나 XML 태그는 절대 출력하지 마십시오.
출처를 언급할 때는 반드시 [1], [2] 형태의 번호 표기를 본문 안에 인라인으로 사용하십시오. 번호는 제공된 출처 목록의 번호와 일치해야 합니다.
사실관계가 불명확하면 단정하지 말고 사실관계 확인 모드로 응답하십시오.`;

  let finalText = "";
  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: answerSystemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      finalText += event.delta.text;
      emit({ type: "token", text: event.delta.text });
    }
  }

  const cited = pickCitedSources(finalText, sources);
  const mode = /##\s*사실관계 확인 필요/.test(finalText) ? "clarify" : "answer";
  emit({ type: "done", citations: cited, mode });
}

try {
  await mcpClient.connect(transport);
  const { tools } = await mcpClient.listTools();
  const anthropicTools = mcpToolsForAnthropic(tools);

  // Tool-calling loop — only responsible for gathering tool results
  const messages = [...history, { role: "user", content: query }];
  const MAX_TOOL_CALLS = 2;
  const MAX_LOOPS = 8;
  let toolCallCount = 0;
  let loopCount = 0;
  const collectedResults = [];

  emit({ type: "status", message: "생각 중..." });

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      if (toolCallCount < MAX_TOOL_CALLS) {
        // Not enough tools called — nudge
        const nudge = toolCallCount === 0
          ? "반드시 search_law 도구를 먼저 호출하여 관련 법령을 검색하십시오."
          : "search_law로 법령을 검색했습니다. 이제 반드시 get_law_text로 관련 조문 원문을 가져오십시오. 조문 확인 후 답변을 작성합니다.";
        messages.push({ role: "user", content: nudge });
        continue;
      }
      // toolCallCount >= MAX_TOOL_CALLS — stream clean final answer
      await streamFinalAnswer(query, collectedResults);
      break;
    }

    if (response.stop_reason !== "tool_use") {
      // Unexpected stop — still try to write a final answer from what we have
      await streamFinalAnswer(query, collectedResults);
      break;
    }

    // Process tool calls
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolCallCount++;

      if (block.name === "search_law") {
        emit({ type: "status", message: `${block.input.query ?? "법령"} 검색 중...` });
      } else if (block.name === "get_law_text") {
        emit({ type: "status", message: `${block.input.jo ?? "조문"} 내용 가져오는 중...` });
      }

      const resultText = await callMcpTool(block.name, block.input);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
      collectedResults.push({ tool: block.name, input: block.input, result: resultText });
    }

    if (toolCallCount >= MAX_TOOL_CALLS) {
      // Have enough results — go straight to clean final answer
      await streamFinalAnswer(query, collectedResults);
      break;
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (loopCount >= MAX_LOOPS) {
    emit({ type: "error", message: "법령 검색이 예상보다 오래 걸렸습니다. 다시 시도해 주세요." });
  }

  await mcpClient.close();
} catch (e) {
  try { await mcpClient.close(); } catch {}
  emit({ type: "error", message: e.message ?? "MCP 오류" });
  process.exit(1);
}
