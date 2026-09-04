/**
 * The judgement of a preflight run, read off its result record and its bundle and never off
 * its log. Before an arm runs, one seed per arm is run under the campaign's CLI and asked four
 * things: that the result names the CLI the campaign's setup built, that the run left a bundle
 * that verifies, that the bundle records the wall budget the harness handed the CLI, and that
 * the suite command the task named reached the shell rather than being refused by its
 * allowlist. A preflight that fails any of them is a defect to fix before the arm runs, not a
 * note beside its numbers.
 */

export function judgePreflight({ result, cliRecord, payloads, suiteCommand, expectedWallMinutes }) {
  const findings = [];
  const pass = (name, detail) => findings.push({ check: name, held: true, detail });
  const fail = (name, detail) => findings.push({ check: name, held: false, detail });

  const recorded = result.cli?.tarballSha256 ?? null;
  if (recorded === null) {
    fail("cli-digest", "the result carries no CLI tarball digest");
  } else if (recorded !== cliRecord.tarballSha256) {
    fail("cli-digest", `the result names ${recorded}, setup built ${cliRecord.tarballSha256}`);
  } else {
    pass("cli-digest", `sha256:${recorded}, the one setup built`);
  }

  if (result.bundle === null) {
    fail("bundle", `no bundle: ${result.outcome}${result.timedOut ? ", the container killed it at the budget" : ""}`);
  } else if (result.bundle.verified !== true) {
    fail("bundle", `the bundle was refused by its own verifier, exit ${result.bundle.verifierExitCode}`);
  } else {
    pass("bundle", "present and verified by its own verifier");
  }

  const budget = payloads.find((entry) => entry.type === "session-budget");
  const wallMs = budget?.payload?.maxWallTimeMs ?? null;
  if (wallMs === null) {
    fail("wall-budget", "no session-budget record: the CLI was not given a wall budget over the run");
  } else if (wallMs !== expectedWallMinutes * 60_000) {
    fail("wall-budget", `the run was given ${wallMs / 60_000} minutes where ${expectedWallMinutes} were expected`);
  } else {
    pass("wall-budget", `${expectedWallMinutes} minutes, recorded on the chain`);
  }

  // A shell call is two records: the request, and the decision with what came back. The
  // decision is what says whether the command reached the shell or the allowlist refused it.
  const decided = payloads.filter(
    (entry) => entry.type === "tool-call" && entry.payload?.toolName === "shell" && entry.payload.decision !== "requested",
  );
  const suiteCalls = decided.filter((entry) => typeof entry.payload.input?.command === "string" && entry.payload.input.command.includes(suiteCommand));
  const refused = suiteCalls.filter((entry) => entry.payload.decision === "denied" && /not on the shell allowlist/.test(entry.payload.detail ?? ""));
  const allowed = suiteCalls.filter((entry) => entry.payload.decision === "allowed");
  if (suiteCalls.length === 0) {
    fail("suite-through-shell", `the model never ran \`${suiteCommand}\` through the shell, so the allowlist was not exercised`);
  } else if (refused.length > 0 && allowed.length === 0) {
    fail("suite-through-shell", `every one of ${refused.length} \`${suiteCommand}\` call(s) was refused by the shell allowlist`);
  } else if (refused.length > 0) {
    fail("suite-through-shell", `${refused.length} \`${suiteCommand}\` call(s) refused by the allowlist beside ${allowed.length} allowed`);
  } else if (allowed.length === 0) {
    fail("suite-through-shell", `${suiteCalls.length} \`${suiteCommand}\` call(s) were decided but none reached the shell: ${suiteCalls.map((entry) => entry.payload.detail).join("; ").slice(0, 200)}`);
  } else {
    pass("suite-through-shell", `${allowed.length} \`${suiteCommand}\` call(s) reached the shell, none refused`);
  }

  return { held: findings.every((finding) => finding.held), findings };
}

export function renderPreflight(name, judgement) {
  const lines = [`preflight ${name}: ${judgement.held ? "HELD" : "FAILED"}`];
  for (const finding of judgement.findings) {
    lines.push(`  ${finding.held ? "held" : "FAILED"}  ${finding.check}: ${finding.detail}`);
  }
  return lines.join("\n");
}
