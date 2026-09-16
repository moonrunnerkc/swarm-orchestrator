/**
 * Whether a run answers a shell-allowlist prompt itself or asks the person. `auto` covers only
 * that prompt: a derivation-heuristic prompt, the injection defence, asks under either mode
 * (ADR 0011). Read from `--approve`, `SWARM_APPROVAL` and `[tools] approval`, and written back
 * into swarm.toml once the person has been asked.
 */
export type ApprovalMode = "ask" | "auto";

export const approvalModes: readonly ApprovalMode[] = ["ask", "auto"];

export function parseApprovalMode(raw: string, source: string): ApprovalMode {
  const found = approvalModes.find((mode) => mode === raw);
  if (found === undefined) {
    throw new Error(
      `${source} was "${raw}"; the approval mode is one of ${approvalModes.join(", ")}`,
    );
  }
  return found;
}

const approvalLine = /^approval[ \t]*=[ \t]*"(?:ask|auto)"[ \t]*$/m;

/**
 * The file with the mode in its tools table: the value replaced where the table already names
 * one, the table appended where the file has none, and nothing else touched, since the rest of
 * the file is the person's.
 */
export function withToolsApproval(tomlText: string, mode: ApprovalMode): string {
  const line = `approval = "${mode}"`;
  if (/^\[tools\]\s*$/m.test(tomlText) && approvalLine.test(tomlText)) {
    return tomlText.replace(approvalLine, line);
  }
  const table = `[tools]\n${line}\n`;
  if (tomlText.trim().length === 0) {
    return table;
  }
  return `${tomlText.replace(/\n*$/, "\n")}\n${table}`;
}
