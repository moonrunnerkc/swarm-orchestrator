/**
 * What one execution of a held-back check on one commit showed, and what a pair of executions
 * (base and head) establishes about a requirement.
 *
 * The earlier arm counted any non-zero exit on the base as the check "detecting" the
 * requirement, so a crash, a syntax error in the check, a project that did not start, a missing
 * fixture or a broken runner all read as detection, and an install failure or a timeout on the
 * base read as "does not fail on the base". Here each side is classified first:
 *
 * - `passed`: exit 0 with at least one test not skipped.
 * - `assertion-failure`: the check ran and an assertion it states failed (a behavioural result).
 * - `missing-feature`: the failure names a symbol, module, file or route that the head adds
 *   (found in the pull request's added lines or added paths), which is what a feature check
 *   is supposed to show on the base.
 * - `startup-or-setup-failure`: dependencies could not be installed, the runner is missing, the
 *   project itself does not load, a module the pull request does not add is missing, or the
 *   check needs a network or browser the container does not provide.
 * - `check-invalid`: the check itself is broken (its own syntax, a fixture that does not
 *   exist, a name it invents, an uncaught error that is not an assertion, every test skipped).
 * - `timeout`, `not-run`.
 *
 * Only `assertion-failure` or `missing-feature` on the base with `passed` on the head
 * establishes a met requirement; the same genuine unmet requirement on both sides is a
 * violation candidate that must still pass the trace audit. Nothing else is detection.
 */

export const SIDE_OUTCOMES = [
  "passed",
  "assertion-failure",
  "missing-feature",
  "startup-or-setup-failure",
  "check-invalid",
  "timeout",
  "not-run",
];

export const TASK_TYPES = ["bugfix", "feature", "refactor", "dependency-upgrade", "api", "browser"];

/** Added lines and the paths added or modified, from a unified diff. */
export function additionsOfDiff(diff) {
  const lines = [];
  const paths = [];
  for (const line of String(diff ?? "").split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "");
      if (path !== "/dev/null") paths.push(path);
    } else if (line.startsWith("+") && !line.startsWith("+++")) lines.push(line.slice(1));
  }
  return { text: lines.join("\n"), paths };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stem = (path) =>
  path
    .split("/")
    .at(-1)
    .replace(/\.[^.]+$/, "");

/** Whether the pull request adds `name`: as a word in its added lines or as an added path. */
export function headAdds(name, added) {
  if (!name) return false;
  const clean = name.replace(/^[./~@#]+/, "");
  if (clean === "") return false;
  if (/[/.]/.test(clean)) {
    // A module path (`a.b.c`, `../src/foo`, `src/foo.ts`): its last segment names a file the
    // head adds or modifies, or its dotted form names a directory path the head touches.
    const last = stem(clean.replace(/\./g, "/"));
    const asPath = clean.replace(/\./g, "/");
    if (added.paths.some((path) => stem(path) === last || path.includes(asPath))) return true;
  }
  // A file the head adds or modifies named after it (`total` for `src/lib/total.ts`).
  if (added.paths.some((path) => stem(path) === stem(clean))) return true;
  return new RegExp(`(^|[^\\w$])${escapeRegExp(clean)}([^\\w$]|$)`).test(added.text);
}

const runnerMissing =
  /No module named '?(pytest|_pytest|unittest|coverage)'?|\b(pytest|vitest|jest|mocha|node|npm|npx|uv|python3?|tsx|ts-node|bash|sh): (command )?not found|command not found|Cannot find module '(vitest|jest|mocha|tsx)[/']|ERR_MODULE_NOT_FOUND[^\n]*'(vitest|jest|mocha)'/;
const needsNetwork =
  /getaddrinfo (ENOTFOUND|EAI_AGAIN)|ECONNREFUSED|EAI_AGAIN|Network is unreachable|Temporary failure in name resolution|Could not resolve host|Name or service not known/;
const needsBrowser =
  /Executable doesn't exist|browserType\.launch|Could not find (Chrome|Chromium|a browser|expected browser)|playwright install|Failed to launch the browser/;

/** Names a failure reports missing, with whether each is a module (vs a symbol, file or route). */
function missingNames(output) {
  const found = [];
  const add = (name, kind) => found.push({ name, kind });
  for (const m of output.matchAll(/No module named '([\w.]+)'/g)) add(m[1], "module");
  for (const m of output.matchAll(/cannot import name '(\w+)'(?: from '([\w.]+)')?/g))
    add(m[1], "symbol");
  for (const m of output.matchAll(/module '([\w.]+)' has no attribute '(\w+)'/g))
    add(m[2], "symbol");
  for (const m of output.matchAll(/'\w+' object has no attribute '(\w+)'/g)) add(m[1], "symbol");
  for (const m of output.matchAll(/NameError: name '(\w+)' is not defined/g)) add(m[1], "symbol");
  for (const m of output.matchAll(/Cannot find module '([^']+)'/g)) add(m[1], "module");
  for (const m of output.matchAll(/Failed to (?:resolve import|load url) "?([^"\s]+)"?/g))
    add(m[1], "module");
  for (const m of output.matchAll(/does not provide an export named '(\w+)'/g)) add(m[1], "symbol");
  for (const m of output.matchAll(/No "(\w+)" export is defined/g)) add(m[1], "symbol");
  for (const m of output.matchAll(/\b([\w$.]+) is not a (?:function|constructor)/g))
    add(m[1].split(".").at(-1), "symbol");
  for (const m of output.matchAll(/ReferenceError: (\w+) is not defined/g)) add(m[1], "symbol");
  for (const m of output.matchAll(/Cannot (?:GET|POST|PUT|PATCH|DELETE) (\S+)/g))
    add(m[1], "route");
  return found;
}

function missingFiles(output) {
  const files = [];
  for (const m of output.matchAll(
    /(?:FileNotFoundError|No such file or directory)[^\n]*?'([^']+)'|ENOENT: no such file or directory, \w+ '([^']+)'|(?:grep|cat|test|head|wc): ([^:\n]+): No such file or directory/g,
  ))
    files.push((m[1] ?? m[2] ?? m[3]).replace(/^\/workspace\//, ""));
  return files;
}

const syntaxError =
  /\b(SyntaxError|IndentationError|TabError)\b|Transform failed|Unexpected token|ParseError|syntax error near unexpected token|unexpected EOF while looking for/;
const assertionSignature =
  /AssertionError|^E\s+assert\b|^\s*assert(ion)?\b.*failed|expected [^\n]* to |^\s*Expected:|^\s*- Expected|toBe\(|toEqual\(|^not ok\b|^\s*(✗|×|FAIL\b|FAIL:|FAILED\b)/im;
const uncaughtError =
  /^(?:E\s+)?(?:\w+\.)*(\w*(?:Error|Exception))(?::|$)|^\s*(?:Uncaught )?(TypeError|RangeError|KeyError|ValueError|IndexError)\b/m;

/**
 * Classify one side. `side` is what the harness recorded: `{ ran, setupFailed?, notRunReason?,
 * exitCode, timedOut, stdout, stderr }`. `context.checkPaths` names the check's own files and
 * `context.added` is `additionsOfDiff` of the pull request.
 */
export function classifySide(side, context) {
  const checkPaths = context.checkPaths ?? [];
  const added = context.added ?? { text: "", paths: [] };
  if (side === undefined || side === null)
    return { outcome: "not-run", reason: "this side was not executed" };
  if (side.setupFailed === true)
    return {
      outcome: "startup-or-setup-failure",
      reason: side.notRunReason ?? "dependencies could not be installed",
    };
  if (side.ran === false)
    return { outcome: "not-run", reason: side.notRunReason ?? "this side was not executed" };
  if (side.timedOut === true) return { outcome: "timeout", reason: "the check timed out" };
  const output = `${side.stdout ?? ""}\n${side.stderr ?? ""}`;
  if (side.exitCode === 0) {
    const pytestSkipped = /=+ (\d+ skipped)[^=]*=+/.test(output) && !/\d+ passed/.test(output);
    const vitestSkipped =
      /Tests\s+\d+ skipped/.test(output) && !/Tests\s+[^\n]*\d+ passed/.test(output);
    if (pytestSkipped || vitestSkipped)
      return { outcome: "check-invalid", reason: "every test in the check was skipped" };
    return { outcome: "passed", reason: "exit 0" };
  }
  if (side.exitCode === 125)
    return { outcome: "check-invalid", reason: "the check file was missing when it ran" };
  if (side.exitCode === 126 || side.exitCode === 127 || runnerMissing.test(output))
    return {
      outcome: "startup-or-setup-failure",
      reason: "the check's runner or command is missing from the environment",
    };
  if (needsNetwork.test(output))
    return {
      outcome: "startup-or-setup-failure",
      reason: "the check needs a network, which the container does not provide",
      needs: "network",
    };
  if (needsBrowser.test(output))
    return {
      outcome: "startup-or-setup-failure",
      reason: "the check needs a browser, which the container does not provide",
      needs: "browser",
    };
  for (const { name, kind } of missingNames(output)) {
    if (headAdds(name, added))
      return {
        outcome: "missing-feature",
        reason: `the failure names ${kind} ${name}, which the pull request adds`,
        name,
      };
    if (kind === "module")
      return {
        outcome: "startup-or-setup-failure",
        reason: `module ${name} is missing and the pull request does not add it`,
        name,
      };
    return {
      outcome: "check-invalid",
      reason: `the check uses ${kind} ${name}, which neither side defines and the pull request does not add`,
      name,
    };
  }
  if (syntaxError.test(output)) {
    const inCheck = checkPaths.some((path) => path !== "" && output.includes(path));
    return inCheck
      ? { outcome: "check-invalid", reason: "the check itself does not parse" }
      : {
          outcome: "startup-or-setup-failure",
          reason: "the project does not parse or load on this commit",
        };
  }
  for (const file of missingFiles(output)) {
    if (headAdds(file, added) || added.paths.includes(file))
      return {
        outcome: "missing-feature",
        reason: `the failure names file ${file}, which the pull request adds`,
        name: file,
      };
    return {
      outcome: "check-invalid",
      reason: `the check reads ${file}, which does not exist and the pull request does not add`,
      name: file,
    };
  }
  if (assertionSignature.test(output))
    return { outcome: "assertion-failure", reason: "an assertion the check states failed" };
  const uncaught = output.match(uncaughtError);
  if (uncaught !== null)
    return {
      outcome: "check-invalid",
      reason: `an uncaught ${uncaught[1] ?? uncaught[2]} ended the check, not an assertion`,
    };
  return {
    outcome: "check-invalid",
    reason: `exit ${side.exitCode} with no recognisable assertion or error`,
  };
}

const detection = new Set(["assertion-failure", "missing-feature"]);

/**
 * What a check's base and head outcomes establish, for the row's task type. Returns
 * `{ decision, reason }` where decision is `met`, `violated-candidate` (still subject to the trace
 * audit) or `unjudged`.
 */
export function decideCheck({ taskType, base, head, requirementText, needs }) {
  if (needs === "network" || needs === "browser")
    return {
      decision: "unjudged",
      reason: `the check needs a ${needs}, which the network-disabled container does not provide`,
    };
  for (const [label, side] of [
    ["head", head],
    ["base", base],
  ]) {
    if (side.needs !== undefined)
      return {
        decision: "unjudged",
        reason: `on the ${label}, the check needs a ${side.needs}, which the network-disabled container does not provide (${side.reason})`,
      };
  }
  const blocking = ["not-run", "timeout", "startup-or-setup-failure", "check-invalid"];
  for (const [label, side] of [
    ["base", base],
    ["head", head],
  ])
    if (blocking.includes(side.outcome))
      return {
        decision: "unjudged",
        reason: `the check's ${label} run is ${side.outcome} (${side.reason}), so it shows nothing about the requirement`,
      };
  if (taskType === "refactor") {
    // An equivalence check: the behaviour it pins must hold on the base for there to be
    // anything to preserve, and then must hold on the head.
    if (base.outcome !== "passed")
      return {
        decision: "unjudged",
        reason:
          "the equivalence check does not pass on the base, so it pins no behaviour to preserve",
      };
    if (head.outcome === "passed")
      return {
        decision: "met",
        reason: "the behaviour the check pins is the same on base and head",
      };
    return {
      decision: "violated-candidate",
      reason: `behaviour that held on the base does not hold on the head (${head.reason})`,
    };
  }
  if (base.outcome === "passed")
    return {
      decision: "unjudged",
      reason: "the check passes on the base, so it does not test the requirement",
    };
  if (!detection.has(base.outcome))
    return { decision: "unjudged", reason: `the base outcome ${base.outcome} is not detection` };
  if (head.outcome === "passed")
    return {
      decision: "met",
      reason: `the base shows the requirement unmet (${base.outcome}: ${base.reason}) and the head passes`,
    };
  if (head.outcome === "missing-feature") {
    // The head lacks what the check names: a violation only when the pull request's own text
    // names it; otherwise the reviewer guessed an interface the pull request never promised.
    const named =
      typeof head.name === "string" &&
      head.name !== "" &&
      String(requirementText ?? "").includes(head.name.split(/[./]/).filter(Boolean).at(-1));
    return named
      ? {
          decision: "violated-candidate",
          reason: `the head still lacks ${head.name}, which the pull request's text names`,
        }
      : {
          decision: "unjudged",
          reason: `the head lacks ${head.name ?? "what the check names"}, which the pull request's text does not name, so the check guessed the interface`,
        };
  }
  return {
    decision: "violated-candidate",
    reason: `the requirement is unmet on the base and still unmet on the head (${head.reason})`,
  };
}
