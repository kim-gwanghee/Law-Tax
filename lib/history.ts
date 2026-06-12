// Conversation window shared by both phases of the tax agent (tool loop + final
// answer). Kept in its own module with NO runtime deps (the Anthropic import is
// type-only and gets stripped) so it stays trivially testable — see
// ../test-history.ts — without pulling in @xenova/transformers via prec-search.
import type Anthropic from "@anthropic-ai/sdk";

export type HistoryMsg = { role: "user" | "assistant"; content: string };

export const MAX_HISTORY = 6;

// The tool loop and the final-answer call must see the SAME prior turns. Without
// this, a follow-up that only adds facts ("네, 제 명의 계약이고 절반은 업무공간이에요")
// reaches the answer model with no reference to the original question, so it
// answers the new facts in a vacuum. Filter blanks, keep the last MAX_HISTORY turns.
export function priorTurns(history: HistoryMsg[]): Anthropic.Messages.MessageParam[] {
  return history
    .filter((m) => m.content && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
}
