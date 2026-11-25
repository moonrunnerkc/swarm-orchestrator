/** Rereads in a row after which the model is told, and after which the run ends. */
const rereadNudge = 4;
export const rereadStop = 6;

/**
 * Counts the turns in a row, before the first change, that re-ran a command whose output an
 * earlier turn of the run had already printed. The repeat stop sees only the turn before, and
 * the quiet stop starts at the first change, so a model reading the same files in a cycle went
 * on until the turns ran out (cmp-feature-pubprep, Arm C, 2026-11-07: steps 9 to 60, no edit).
 * An edit, or a command that printed something new, starts the count again.
 */
export function rereads(): (command: string | null, comparable: string) => number {
  const printed = new Map<string, string>();
  let run = 0;
  return (command, comparable) => {
    if (command === null) {
      run = 0;
      return run;
    }
    run = printed.get(command) === comparable ? run + 1 : 0;
    printed.set(command, comparable);
    return run;
  };
}

/** The note after a reread: what the model is told once the count reaches the nudge. */
export function rereadNote(note: string, count: number): string {
  if (count !== rereadNudge) return note;
  return `${note}\nYour last ${count} commands each printed what an earlier turn of this run had already printed. Nothing has changed since: make the change the task asks for. ${rereadStop - count} more such turns end the run.`;
}

export const rereadReason = (count: number) =>
  `${count} turns running re-ran a command whose output an earlier turn had already printed, before any change`;
