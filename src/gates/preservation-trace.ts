/**
 * An experimental repair procedure (preservation-trace-v1), given only where it was asked for.
 *
 * The alias repair of 2026-10-21 was handed the task, the diff and a failing tests gate in a fresh
 * loop, found its own failing case (`-j 4` now threw), and then tried to observe the function its
 * diff had changed. That function was not exported; the call failed, and the next turn asserted
 * what the function returned instead of observing it. The assertion was wrong, nothing ever ran the
 * same case over the base, and the attempt ended at its wall with no edit.
 *
 * So where a failing gate passed when the harness ran it over the base, the repair is told that as
 * a measurement, and given a procedure: reproduce one preserved case on both trees through the
 * harness, narrow to the first value that differs, fix there, and check the fix against both the
 * preserved case and the task's own examples. run_check's `compare_base` runs one program over the
 * base source and the workspace, so every comparison is an executed observation the ledger holds,
 * not the model's account of one. Nothing here names a project, a runner or an answer.
 */
export const preservationTraceRule = "preservation-trace-v1";

export function preservationTraceBrief(
  passingAtBase: readonly { readonly gateId: string; readonly record: string }[],
): string {
  const gates = passingAtBase
    .map((gate) => `${gate.gateId} (gate-baseline record ${gate.record})`)
    .join(", ");
  return [
    `Trace before you edit (${preservationTraceRule}, a procedure the harness asks for; the first paragraph is measured):`,
    `${gates} passed when the harness ran it over the base source and fails with your change. A failing test the base's test files already had is behaviour the task did not ask to change, which your edit broke; a test your change added is the task's new behaviour.`,
    "1. Take one failing test the base already had. Reproduce its case with run_check: program (an ES module whose default export takes one input), inputs, and compare_base: true. The harness runs the same program over the base source and over your workspace and prints both results.",
    "2. Where they differ, compare again with smaller inputs, or through the narrowest public function that reaches the lines your diff changed, until you find the first value that differs. Go by what the harness printed: where you cannot observe a value, observe a smaller case instead of reasoning about what it would be.",
    "3. Change the code at that point. Then compare again: the preserved case must give what the base gives, and the task's own examples must still give the new results the task states, which the base does not.",
    "4. Keep the tests the task asked for, and add a regression test for the preserved case beside them.",
  ].join("\n");
}
