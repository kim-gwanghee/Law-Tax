// Regression test for the multi-turn memory bug: a follow-up that only adds facts
// must keep the prior conversation turns, or the answer model answers in a vacuum.
// priorTurns() is the shared window fed to BOTH the tool loop and the final-answer
// call (lib/tax-agent.ts), so guarding it guards the fix.
// Run: node test-history.ts   (Node 24 native TS)
import { priorTurns, MAX_HISTORY, type HistoryMsg } from "./lib/history.ts";

let failed = 0;
function check(name: string, cond: boolean) {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
}

// 1) Empty history → no prior turns.
check("empty history → []", priorTurns([]).length === 0);

// 2) A normal Q→A pair survives with roles + content intact. This is the core of
//    the bug: the follow-up answer call must still see "월세 경비처리" Q1.
const pair: HistoryMsg[] = [
  { role: "user", content: "프리랜서가 집에서 일하면 월세를 경비처리할 수 있나요?" },
  { role: "assistant", content: "## 결론\n사업 사용 비율만큼 가능합니다 [1]." },
];
const pt = priorTurns(pair);
check("pair length preserved", pt.length === 2);
check("first turn is the original user question", pt[0].role === "user" && String(pt[0].content).includes("월세"));
check("second turn is the prior assistant answer", pt[1].role === "assistant");

// 3) Blank / whitespace-only turns are filtered (the empty assistant placeholder
//    the client appends before streaming must never leak into the model input).
const withBlanks: HistoryMsg[] = [
  { role: "user", content: "Q1" },
  { role: "assistant", content: "" },
  { role: "user", content: "   " },
  { role: "assistant", content: "A1" },
];
check("blank turns filtered out", priorTurns(withBlanks).length === 2);

// 4) Window is capped at MAX_HISTORY (keeps the most recent turns).
const many: HistoryMsg[] = Array.from({ length: MAX_HISTORY + 4 }, (_, i) => ({
  role: (i % 2 === 0 ? "user" : "assistant") as HistoryMsg["role"],
  content: `m${i}`,
}));
const capped = priorTurns(many);
check("capped to MAX_HISTORY", capped.length === MAX_HISTORY);
check("keeps the most recent turn", String(capped[capped.length - 1].content) === `m${MAX_HISTORY + 3}`);

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("\nAll priorTurns cases passed");
