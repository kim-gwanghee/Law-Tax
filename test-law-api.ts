// Regression test for the DRF article-code conversion that get_law_text relies on.
// Run: node test-law-api.ts   (Node 24 native TS)
import { buildJO } from "./lib/law-api.ts";

const cases: [string, string][] = [
  ["제27조", "002700"],
  ["제127조", "012700"],
  ["제39조의2", "003902"],
  ["제1조", "000100"],
  ["제39조 의2", "003902"], // tolerant of spacing
  ["27조", "002700"],       // tolerant of missing 제
  ["잡담", ""],             // non-article → empty
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = buildJO(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  buildJO(${JSON.stringify(input)}) = ${JSON.stringify(got)}  (expected ${JSON.stringify(expected)})`);
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("\nAll buildJO cases passed");
