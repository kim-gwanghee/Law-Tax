import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runTaxQuery, type AgentEvent } from "@/lib/tax-agent";

export const runtime = "nodejs";

// SSE streaming of the tax-law agent. Runs the Anthropic tool loop in-process
// (see lib/tax-agent.ts) — no child process, no MCP subprocess.
export async function POST(req: Request) {
  try {
    const { query, history = [] } = await req.json();
    if (!query?.trim()) return NextResponse.json({ error: "질문이 없습니다." }, { status: 400 });

    console.log("[query]", query.slice(0, 60));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const ac = new AbortController();
        const killTimer = setTimeout(() => ac.abort(), 85_000);
        const emit = (e: AgentEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            /* controller already closed */
          }
        };

        try {
          await runTaxQuery({ query, history, emit, signal: ac.signal });
        } catch (e) {
          if (ac.signal.aborted) {
            emit({ type: "error", message: "법령 검색 서비스가 일시적으로 느립니다. 잠시 후 다시 시도해 주세요." });
          } else {
            console.error("[query] error:", ((e as Error)?.message ?? "").slice(0, 200));
            Sentry.captureException(e); // capture intermittent failures for diagnosis
            emit({ type: "error", message: "서버 오류가 발생했습니다. 다시 시도해 주세요." });
          }
        } finally {
          clearTimeout(killTimer);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("[query] error:", ((e as Error)?.message ?? "").slice(0, 200));
    return NextResponse.json({ error: "서버 오류가 발생했습니다. 다시 시도해 주세요." }, { status: 500 });
  }
}
