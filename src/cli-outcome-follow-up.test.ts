import { expect, test } from "vitest";
import { outcomeFollowUp } from "./cli-outcome-follow-up.ts";
import type { UnresolvedOutcome } from "./cli-plan-checks.ts";

const outcome = (id: string, quote: string | null): UnresolvedOutcome => ({
  id,
  requirement: id.split("#")[0] ?? id,
  quote,
  role: "keep",
  checks: [],
  taskInputs: [
    {
      input: "(See hTtPS://example.com/x.)",
      expected: '{"hasLink":true}',
      base: '{"hasLink":false}',
    },
  ],
  reason: "its cases do not hold the task's own input",
  nextAction: "run it yourself",
});

test("owes nothing where nothing is unresolved", () => {
  expect(outcomeFollowUp([])).toBeNull();
});

test("briefs one follow-up for every unresolved outcome, with the task's own input and the choice to leave the code", () => {
  const owed = outcomeFollowUp([
    outcome("scheme#1", null),
    outcome("scheme#3", "a scheme of any case"),
  ]);
  expect(owed?.brief).toContain(
    'The task\'s own input: "(See hTtPS://example.com/x.)" (the planner first expected {"hasLink":true}; the unchanged base gives {"hasLink":false}).',
  );
  expect(owed?.brief).toContain(
    "not with the planner's expectation and not with what the base gave",
  );
  expect(owed?.brief).toContain("leave the code as it is and say which in one line");
  expect(owed?.brief).toContain("These items stay reported as unresolved either way");
});

test("names the follow-up by the outcomes it covers, however they are ordered", () => {
  const one = outcomeFollowUp([outcome("a#1", "x"), outcome("b#1", "y")]);
  const other = outcomeFollowUp([outcome("b#1", "y"), outcome("a#1", "x")]);
  expect(one?.identity).toBe(other?.identity);
  expect(one?.identity).not.toBe(outcomeFollowUp([outcome("a#1", "x")])?.identity);
});
