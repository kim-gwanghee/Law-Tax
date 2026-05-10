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

function parseCitations(text) {
  const citations = [];
  const seen = new Set();
  for (const p of text.match(/[「\[](.*?)[」\]]/g) ?? []) {
    const title = p.replace(/[「」\[\]]/g, "").trim();
    if (title && !seen.has(title)) { seen.add(title); citations.push({ title }); }
  }
  return citations;
}

// Final answer with a CLEAN context — only query + tool results, no accumulated noise
async function streamFinalAnswer(query, collectedResults) {
  emit({ type: "status", message: "답변 작성 중..." });

  const resultsText = collectedResults
    .map((r) => `[${r.tool} 결과]\n${r.result}`)
    .join("\n\n");

  const userMessage = [
    "[법령 검색 결과]",
    resultsText || "검색 결과 없음",
    "",
    "[질문]",
    query,
    "",
    "위 검색된 법령 조문에 근거하여 반드시 다음 형식으로 한국어로 답변하십시오.",
    "",
    "## 결론",
    "[핵심 판단을 2~3문장으로. 가능 여부를 명확히 표현하십시오.]",
    "",
    "## 근거 법령",
    "[검색된 법령명, 조문 번호를 명시하고 결론과의 연결을 설명하십시오. 조문 핵심 내용을 인용하십시오.]",
    "",
    "## 유의사항",
    "[전제 사실관계, 결론이 달라질 수 있는 조건, 추가 확인 필요 사항을 안내하십시오.]",
  ].join("\n");

  // Use a minimal system prompt — no tool-calling instructions.
  // The original systemPrompt includes "반드시 search_law → get_law_text 호출" which causes
  // the model to output raw <function_calls> XML when no tools are registered.
  const answerSystemPrompt = `당신은 세무사를 보조하는 세법 분석 전문가입니다.
제공된 법령 조문 검색 결과만을 근거로 한국어로 답변합니다.
도구 호출이나 XML 태그는 절대 출력하지 마십시오.
반드시 ## 결론 / ## 근거 법령 / ## 유의사항 3개 섹션 형식으로만 답변하십시오.`;

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

  emit({ type: "done", citations: parseCitations(finalText) });
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
