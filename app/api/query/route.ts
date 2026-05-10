import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

const SYSTEM_PROMPT = `당신은 세무사를 보조하는 세법·법령 질의응답 AI입니다.
법령정보 API로 검색한 조문에만 근거하여 답변합니다.

⚠️ 필수: 모든 질문에 대해 반드시 search_law → get_law_text 순서로 도구를 호출한 뒤 답변하십시오. 도구를 호출하지 않고 직접 답변하는 것은 금지됩니다.

━━━ 도구 사용 규칙 ━━━

[규칙 1: 법률명으로만 검색]
search_law의 query에는 반드시 정식 법률명만 사용하십시오.
올바른 예: "소득세법", "부가가치세법", "법인세법"
금지 예: "원천징수", "외주비", "경비처리" → NOT_FOUND 발생

[규칙 2: 도구를 한 번에 하나씩만 호출]
동시에 여러 도구를 호출하지 마십시오. 순서대로 1회 호출 → 결과 확인 → 다음 호출.

[규칙 3: 질문 유형별 검색 경로]
▶ 원천징수 (사업소득·기타소득·근로소득 지급 시)
  1. search_law("소득세법") → MST 확인
  2. get_law_text(MST, "제127조") → 원천징수의무 확인

▶ 필요경비·사업 경비 처리 (개인사업자)
  1. search_law("소득세법") → MST 확인
  2. get_law_text(MST, "제27조") → 사업소득 필요경비 확인

▶ 부가가치세 (매입세액·면세·세금계산서)
  1. search_law("부가가치세법") → MST 확인
  2. get_law_text(MST, "제39조") → 불공제 매입세액 확인

▶ 법인세 (손금·익금·세액공제)
  1. search_law("법인세법") → MST 확인
  2. get_law_text(MST, "제19조") → 손금 범위 확인

▶ 상속·증여
  1. search_law("상속세 및 증여세법") → MST 확인
  2. get_law_text(MST, "제1조") → 목적 확인

━━━ 답변 원칙 ━━━

1. 근거 기반 답변
- 검색된 조문에 근거가 있는 내용만 답변하십시오.
- 검색 결과에 직접적인 근거가 없으면 "검색된 조문만으로는 판단이 어렵습니다. 추가 법령 검색 또는 사실관계 확인이 필요합니다."라고 답하십시오.
- 존재하지 않는 법령명, 조문 번호, 세율, 요건, 기한을 생성하지 마십시오.
- 조문 간 내용이 충돌하면 충돌 사실을 명시하고 단정적 결론을 피하십시오.

2. 민토 피라미드 원칙 (결론 먼저)
- 핵심 결론을 첫 섹션에 제시하고, 이후 근거와 유의사항을 작성하십시오.
- "가능합니다", "의무가 있습니다", "요건 충족 시 가능합니다"처럼 판단 수준을 명확히 표현하십시오.
- 근거가 불충분하면 "검색된 조문 기준으로는 단정하기 어렵습니다"라고 표현하십시오.

3. 불확실성 처리
- 근거가 명확하지 않으면 추측하여 단정하지 마십시오.
- 사실관계가 모호하면 결론에 영향을 줄 수 있는 조건을 명시하십시오.

4. 금지사항
- 검색 결과에 없는 내용을 알고 있는 것처럼 말하지 마십시오.
- "반드시 절세 가능", "문제없음", "무조건 인정" 같은 과도하게 단정적인 표현을 사용하지 마십시오.

━━━ 출력 형식 ━━━

반드시 아래 3개 섹션으로 답변하십시오.

## 결론

[핵심 판단을 2~4문장으로 제시. 가능 여부를 명확히 표현. 근거 불충분 시 조건부 또는 판단 유보로 표현.]

## 근거 법령

[검색된 법령명과 조문 번호를 명시하고, 해당 조문이 결론과 어떻게 연결되는지 설명. 조문 원문 중 핵심 부분만 인용.]

## 유의사항

[전제한 사실관계, 결론이 달라질 수 있는 조건, 추가 확인이 필요한 사항을 간략히 안내.]`;


export async function POST(req: Request) {
  try {
    const { query, history = [] } = await req.json();
    if (!query?.trim()) return NextResponse.json({ error: "질문이 없습니다." }, { status: 400 });

    console.log("[query]", query.slice(0, 60));

    const script = path.join(process.cwd(), "scripts", "mcp-runner.mjs");
    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      start(controller) {
        const child = spawn(process.execPath, [script], {
          env: {
            ...process.env,
            MCP_PAYLOAD: JSON.stringify({
              query,
              history: history.map((m: { role: string; content: string }) => ({
                role: m.role,
                content: m.content,
              })),
              systemPrompt: SYSTEM_PROMPT,
            }),
          },
        });

        const killTimer = setTimeout(() => child.kill("SIGTERM"), 85_000);
        let gotDone = false;
        let stdoutBuf = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "done") gotDone = true;
            } catch {}
            controller.enqueue(encoder.encode(`data: ${line}\n\n`));
          }
        });

        child.stderr.on("data", (d: Buffer) => { stderr += d; });

        child.on("close", (_code: number | null, signal: NodeJS.Signals | null) => {
          clearTimeout(killTimer);
          if (stderr) console.error("[mcp-runner]", stderr.slice(0, 500));
          if (signal === "SIGTERM" && !gotDone) {
            const errEvent = JSON.stringify({
              type: "error",
              message: "법령 검색 서비스가 일시적으로 느립니다. 잠시 후 다시 시도해 주세요.",
            });
            controller.enqueue(encoder.encode(`data: ${errEvent}\n\n`));
          }
          controller.close();
        });

        child.on("error", (err: Error) => {
          clearTimeout(killTimer);
          const errEvent = JSON.stringify({ type: "error", message: err.message });
          controller.enqueue(encoder.encode(`data: ${errEvent}\n\n`));
          controller.close();
        });
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("[query] error:", msg.slice(0, 200));
    return NextResponse.json({ error: "서버 오류가 발생했습니다. 다시 시도해 주세요." }, { status: 500 });
  }
}
