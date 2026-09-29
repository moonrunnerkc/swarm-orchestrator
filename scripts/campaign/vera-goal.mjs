/**
 * The native VERA translation of a goal's visible requirement, frozen as one rule for every goal:
 * the project's own test command and the visible checks as `exit_code` contracts, and the
 * acceptance material plus the contract's immutable paths as `readonly`. VERA 1.0.0-rc.4's
 * readonly globs do not cross `/`, so each protected directory is listed at three depths; deeper
 * files stay unprotected, which is a property of the tool and is reported as such.
 */
const quote = (value) => JSON.stringify(value);

export function readonlyGlobs(contract) {
  const roots = ["acceptance/visible", ".campaign", ...contract.immutablePaths];
  const globs = new Set();
  for (const root of roots) {
    globs.add(root);
    globs.add(`${root}/*`);
    globs.add(`${root}/*/*`);
    globs.add(`${root}/*/*/*`);
  }
  return [...globs];
}

export function veraGoalYaml(goal, contract) {
  const lines = [
    `agent: ${quote("campaign")}`,
    `goal: ${quote(goal.taskText.split("\n")[0].slice(0, 200))}`,
    "contracts:",
    `  - type: ${quote("exit_code")}`,
    `    args: [${goal.projectTest.map(quote).join(", ")}]`,
    `  - type: ${quote("exit_code")}`,
    `    args: [${["node", ".campaign/visible-runner.mjs", ".campaign/contract.json", "--from-tree"].map(quote).join(", ")}]`,
    `  - type: ${quote("readonly")}`,
    `    args: [${readonlyGlobs(contract).map(quote).join(", ")}]`,
  ];
  return `${lines.join("\n")}\n`;
}
