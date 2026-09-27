import { expect, it } from "vitest";
import { assertGoalEffectsSettled } from "./goal-effects.ts";

const intent = { phase: "intent", contractDigest: "contract", tree: "tree", checkId: "behavior" };
function verify(values: unknown[]) {
  assertGoalEffectsSettled(
    values.map((_, at) => ({ type: "goal-check", payloadDigest: String(at) })),
    new Map(values.map((value, at) => [String(at), value])),
  );
}
it("accepts completed effects and legacy observations", () => {
  expect(() =>
    verify([{ status: "accepted" }, intent, { ...intent, phase: "completed" }]),
  ).not.toThrow();
});
it.each(
  [
    [intent],
    [intent, intent],
    [{ ...intent, phase: "completed" }],
    [intent, { ...intent, phase: "completed", tree: "other" }],
  ].map((values) => ({ values })),
)("requires reconciliation of ambiguous effects", ({ values }) => {
  expect(() => verify(values)).toThrow("reconcile");
});
