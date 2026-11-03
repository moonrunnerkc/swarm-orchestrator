/** The verifier's requirement lines still open, as its feedback lists them. */
export const openFindings = (findings: string | null) =>
  (findings ?? "").split("\n").filter((line) => /^R\d+ /.test(line));

/** A command repeated while findings are open is the run circling: point back at them. */
export function circlingNote(note: string, repeats: number, findings: string | null): string {
  const open = openFindings(findings);
  if (repeats < 2 || open.length === 0) return note;
  return [
    note,
    "The verifier's findings are still open:",
    ...open,
    "Act on them: change the tree, or send the corrected requirements block, then mark the task complete.",
  ].join("\n");
}
