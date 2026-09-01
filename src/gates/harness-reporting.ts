import {
  harnessControlledNodeTest,
  processIsolation,
  type VouchedArgv,
} from "./node-test-command.ts";

/**
 * How the harness asks node's own runner to report to it, and why it asks for streams rather
 * than for files.
 *
 * Reading a measurement out of a gate's stdout put the measurement inside the surface being
 * measured: a test printing four counter lines reported 999 tests collected for a suite of one.
 * The first fix was to have the runner write reports to paths the harness named under the
 * session store, and read those. An adversarial pass took that apart, and it is worth being
 * exact about how far it got.
 *
 * A destination is an argument of the process the harness spawns, so `ps -p $PPID -o command=`
 * hands it to any test that asks: that much is deterministic. The file is writable by anything
 * running as the same user, and a test that found the path and wrote it turned a real `1..2`
 * into a self-consistent forged `1..500`. Unix permissions do not help, because the forger is
 * the same uid.
 *
 * What that did not achieve was making the harness read the forgery. The harness reads the file
 * as soon as the runner exits, and it won that race in every attempt. What the attack did
 * achieve, in four attempts out of four, was to destroy both measures: a test hammering the two
 * paths left torn files, both parsed as nothing, and both blocking arms abstained. An abstention
 * is not a violation, so a test could switch the ratchet's two runner-reported arms off at will.
 * That is a smaller finding than a forged number and a real one.
 *
 * So there is no file. Both reports go to streams of the process the harness spawned, and the
 * harness reads them off the pipes it already owns. What makes that safe is the isolation
 * setting: under `--test-isolation=process` a test runs in a child whose output the parent
 * captures and folds into the reporters' streams as escaped comments. Measured on the same
 * attack: a test writing a complete 500-point TAP document to its own stdout produced
 * `# ok 1 - forged 1` and `# 1..500` in the parent's stream, every line commented, while the
 * real `1..2` stood at column zero. A test writing forged lcov records reached the parent's
 * stderr not at all.
 *
 * lcov rather than node's printed coverage table, for the reason that always applied: the table
 * shares a stream with whatever the tests wrote, and an lcov report carries coverage records and
 * nothing else, so there is no line in it for a test to write.
 *
 * All of it holds only while the harness controls the invocation. `node-test-command.ts` decides
 * that, recognising a declared command completely or not at all. Not at all means no reporters
 * are imposed, the streams are whatever the project's own command produces, and both measures
 * abstain rather than being read from output nobody vouched for.
 */

/**
 * The vector that measures this gate, or null to abstain. Null is the honest answer wherever
 * the harness cannot vouch for the invocation in full: the arm then reports not measured by
 * name rather than reporting a number it cannot stand behind.
 *
 * The stdout reporter is restated because naming any reporter replaces the default one, and
 * stdout is where the collected count is read from. The lcov reporter goes to stderr so the two
 * arrive on separate pipes and neither has to be picked out of the other.
 *
 * What is deliberately absent is any attempt to talk a declared command into safety. A project
 * that asks for a shared process, a loader hook, or a reporter of its own is not corrected, it
 * is left unmeasured, because the correction would have to predict what a shell makes of the
 * text it is correcting.
 */
export function harnessReportingCommand(body: string | undefined): VouchedArgv | null {
  return harnessControlledNodeTest(body, [
    "--experimental-test-coverage",
    processIsolation,
    "--test-reporter=tap",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    "--test-reporter-destination=stderr",
  ]);
}
