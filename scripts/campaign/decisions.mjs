/**
 * How each arm's own output becomes one of the campaign's decisions: accept, refuse or
 * inconclusive. These are the registered readings; a change to any of them is a protocol
 * amendment, never a quiet edit, because it changes what every row says.
 */

/**
 * swarm-verify `ci --json` (schema swarm.ci.v1) under a goal contract. Accept only a verified
 * run: task accepted and regression passing. Refuse a regression charged to the patch, a task
 * the contract rejected or found vacuous, and a required challenge that was not met. Anything
 * else, including a run refused before it measured, is inconclusive.
 */
export function swarmCiDecision(report) {
  if (report === null || typeof report !== "object") return "inconclusive";
  if (report.verified === true) return "accept";
  const certification = JSON.stringify(report.certification ?? report.certificationPolicy ?? "");
  if (
    report.regression === "fail" ||
    report.task === "rejected" ||
    report.task === "vacuous" ||
    /challenges-unmet/.test(certification) ||
    /challenges-unmet/.test(String(report.refusal ?? ""))
  )
    return "refuse";
  return "inconclusive";
}

/** Plain CI: every step exited 0, or it did not. CI has no third answer. */
export function ciDecision(exitCodes) {
  return exitCodes.length > 0 && exitCodes.every((code) => code === 0) ? "accept" : "refuse";
}

/**
 * VERA 1.0.0-rc.4 `vera verify`: exit 0 with a GOAL PASS line accepts; a FAIL line refuses; a
 * verify that printed neither (it could not read its own state) is inconclusive.
 */
export function veraDecision(exitCode, stdout) {
  if (exitCode === 0 && /GOAL PASS/.test(stdout)) return "accept";
  if (/\bFAIL\b/.test(stdout) || /GOAL FAIL/.test(stdout)) return "refuse";
  return "inconclusive";
}

/**
 * The swarm task command (`swarm "<task>" --json`, schema swarm.result.v1 on its last line):
 * exit 0 is an acceptable run; exit 1 a finished run whose product was not acceptable; the
 * cancelled, unavailable and internal-error codes, or no result line, are inconclusive.
 */
export function swarmTaskDecision(exitCode, resultLine) {
  if (resultLine === null) return "inconclusive";
  if (exitCode === 0 && resultLine.verdict?.acceptable === true) return "accept";
  if (exitCode === 1) return "refuse";
  return "inconclusive";
}

/** The tokens a swarm task spent, from its `stopped` events (input and output combined). */
export function swarmTaskTokens(stdout) {
  let total = 0;
  let seen = false;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.schema === "swarm.event.v1" && parsed.event?.type === "stopped") {
      total += parsed.event.tokensUsed;
      seen = true;
    }
  }
  return seen ? total : null;
}

/** The last swarm.result.v1 line of a task's stdout, or null. */
export function swarmResultLine(stdout) {
  const lines = stdout.split("\n").filter((line) => line.startsWith("{"));
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.schema === "swarm.result.v1") return parsed;
    } catch {}
  }
  return null;
}

/** The last JSON object line of a `ci --json` run, or null. */
export function lastJsonLine(stdout) {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}
