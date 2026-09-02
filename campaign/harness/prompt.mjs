/**
 * The task every arm is given, one template, the repository's own test command filled in.
 * Command and check: it says what to run to see the failure and what passing looks like, and
 * it names the fallback, which is to say NOT-DONE rather than to weaken a test. The prompt
 * never names the file or the line, since that is the defect the run is meant to find.
 */
export function taskPrompt(testCommand) {
  return [
    `The test suite of this repository fails. Run \`${testCommand}\` to see which tests fail and why.`,
    "Find the defect in the source that makes them fail and fix it, so that the same command passes.",
    "Do not edit, delete, skip or weaken any test: the tests are the specification, and a change",
    "to them is not a fix.",
    "If you cannot find the defect, leave the tree as it is and reply NOT-DONE with what you",
    "checked and what you ruled out.",
  ].join(" ");
}
