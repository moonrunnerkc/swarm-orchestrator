/**
 * What a gate's failure looks like once the parts that vary between two runs of the same
 * command are removed: the detail the parser wrote and every line the runner printed, with
 * numbers dropped so a timing, a line count or a duration does not make two identical
 * failures read as different ones, and order dropped so a runner that lists files in another
 * order does not either. Every line counts, not only the ones marked as failures, because a
 * linter's offender lines carry no marker and the exit-code rule's detail names no file: two
 * outputs that differ anywhere are two failures, which errs toward naming nothing rather
 * than toward calling a new failure an old one. It says nothing about whether either failure
 * was the run's doing until it is compared with a run over the base.
 */
export interface FailureOutput {
  readonly detail: string;
  readonly stdout: string;
  readonly stderr: string;
}

const numbers = /\d+(\.\d+)?/g;

export function failureSignature(output: FailureOutput): string {
  const lines = `${output.stdout}\n${output.stderr}`
    .split("\n")
    .map((line) => line.replace(numbers, "#").trim())
    .filter((line) => line.length > 0);
  return `${output.detail.replace(numbers, "#")}\n${[...new Set(lines)].sort().join("\n")}`;
}
