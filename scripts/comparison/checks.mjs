/**
 * Two readings of a tree, both over a fresh checkout of the base with the visible check
 * committed and the arm's change applied, prepared with the task's own install argv:
 *
 * - the visible verdict, which is what the supervision protocol feeds back: the committed visible
 *   check and the project's own tests;
 * - the hidden verdict, which scores the task: the upstream commit's test files overlaid from the
 *   sealed mirror, its specific test argv, and for a refactor the structural checks, for an
 *   upgrade the installed versions. Hidden material is read from the mirror at scoring time only
 *   and never enters an arm's workspace.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";
import { swarmChildHomeName } from "./arms.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  installEnvironment,
  mirrorOf,
  prepare,
  tail,
  writeArmConfiguration,
} from "./workspace.mjs";

async function freshTree(log, task, base, patch, label) {
  const scratch = mkdtempSync(join(comparisonRoot, "work", `${label}-${task.id}-`));
  const checkout = join(scratch, "checkout");
  await cloneAtBase(log, task, base, checkout);
  await commitVisibleCheck(log, task, checkout);
  if (!(await applyPatch(log, checkout, patch)))
    return {
      scratch,
      checkout,
      prepared: { ok: false, failed: ["git", "apply"], detail: "the patch does not apply" },
    };
  const prepared = await prepare(log, task, checkout);
  return { scratch, checkout, prepared };
}

const run = (log, checkout, argv, timeoutMs = 900_000) =>
  log.run(argv, { cwd: checkout, timeoutMs, env: installEnvironment() });

/** The visible verdict and the text the supervisor hands back on failure. */
export async function visibleVerdict(log, task, base, patch) {
  const tree = await freshTree(log, task, base, patch, "visible");
  try {
    if (!tree.prepared.ok)
      return {
        passed: false,
        checkExit: null,
        projectTestExit: null,
        detail: `preparation failed (${tree.prepared.failed.join(" ")}):\n${tree.prepared.detail}`,
      };
    const check = await run(log, tree.checkout, ["sh", "-c", task.visible.command]);
    const project = await run(log, tree.checkout, task.projectTest);
    const passed = check.exitCode === 0 && project.exitCode === 0;
    const detail = passed
      ? "visible check and project tests passed"
      : [
          check.exitCode === 0
            ? ""
            : `visible check (${task.visible.command}) exited ${check.exitCode}:\n${tail(check)}`,
          project.exitCode === 0
            ? ""
            : `project tests (${task.projectTest.join(" ")}) exited ${project.exitCode}:\n${tail(project)}`,
        ]
          .filter(Boolean)
          .join("\n\n");
    return { passed, checkExit: check.exitCode, projectTestExit: project.exitCode, detail };
  } finally {
    rmSync(tree.scratch, { recursive: true, force: true });
  }
}

/**
 * The project's own lint script over the base with the visible check committed. A check file the
 * project's linter rejects fails every candidate's lint gate for a reason the candidate did not
 * cause: the first freeze's js-yaml checks did, and Swarm's preflight refused those tasks before
 * any model call. No lint script, or lint already failing on the bare base, leaves nothing for
 * the check to break.
 */
export async function lintVerdict(log, task, base) {
  const tree = await freshTree(log, task, base, "", "lint");
  try {
    if (!tree.prepared.ok)
      return {
        ok: false,
        applicable: true,
        detail: `preparation failed:\n${tree.prepared.detail}`,
      };
    const manifest = JSON.parse(readFileSync(join(tree.checkout, "package.json"), "utf8"));
    if (typeof manifest.scripts?.lint !== "string")
      return { ok: true, applicable: false, detail: "the project declares no lint script" };
    const lint = ["npm", "run", "--loglevel=error", "lint"];
    const withCheck = await run(log, tree.checkout, lint);
    if (withCheck.exitCode === 0)
      return {
        ok: true,
        applicable: true,
        detail: "lint passes with the visible check in the tree",
      };
    rmSync(join(tree.checkout, "acceptance"), { recursive: true, force: true });
    const bare = await run(log, tree.checkout, lint);
    return bare.exitCode === 0
      ? {
          ok: false,
          applicable: true,
          detail: `the visible check fails the project's lint:\n${tail(withCheck)}`,
        }
      : { ok: true, applicable: true, detail: "lint already fails on the bare base" };
  } finally {
    rmSync(tree.scratch, { recursive: true, force: true });
  }
}

/**
 * Swarm's effective gate plan over the prepared base, measured by the product itself with no
 * model: the pinned CLI's `check` command, under the launch's own child HOME, over a fresh
 * checkout configured exactly as the launch's workspace will be. Three things are held together
 * here that the pilot found apart: the command the task text names, the override the harness
 * writes (parsed back by the pinned build's own parser), and the command the product actually
 * ran as its blocking `tests` gate, which must have passed on the base under that HOME. A
 * mismatch or a failing gate is the supervisor's configuration or environment, never the arm's
 * outcome, and stops the launch before it is dispatched.
 */
export async function swarmGatePlanVerdict(log, task, base, pins, childHome) {
  const expected = task.projectTest.join(" ");
  const verdict = (ok, detail, extra = {}) => ({
    ok,
    expected,
    effective: null,
    status: null,
    bundleDirectory: null,
    detail,
    ...extra,
  });
  const tree = await freshTree(log, task, base, "", "gate-plan");
  try {
    if (!tree.prepared.ok)
      return verdict(
        false,
        `preparation failed (${tree.prepared.failed.join(" ")}):\n${tree.prepared.detail}`,
      );
    writeArmConfiguration(tree.checkout, "swarm", pins.endpoint, pins.model, task);
    const written = readFileSync(join(tree.checkout, "swarm.toml"), "utf8");
    // Read back by the pinned build's own parser where the build carries one (the product's
    // dist does); a stand-in arm without one is read by the TOML library the product itself
    // parses with, and the verdict says which.
    const parserPath = join(dirname(pins.swarmCli), "config", "swarm-toml.js");
    const pinnedParser = existsSync(parserPath);
    let parsed;
    try {
      parsed = pinnedParser
        ? (await import(pathToFileURL(parserPath).href)).parseSwarmToml(written, "swarm.toml")
        : parseToml(written);
    } catch (cause) {
      return verdict(
        false,
        `the ${pinnedParser ? "pinned build's" : "TOML"} parser rejects the written swarm.toml: ${cause?.message ?? cause}`,
      );
    }
    const declared = parsed.gates?.tests;
    const declaredCommand = typeof declared === "string" ? declared : declared?.command;
    if (declaredCommand !== expected)
      return verdict(
        false,
        `the written swarm.toml parses to a tests command of ${JSON.stringify(declaredCommand ?? null)}, not ${JSON.stringify(expected)}`,
      );
    const ran = await log.run(
      ["node", pins.swarmCli, "check", "--workspace", tree.checkout, "--json"],
      {
        cwd: tree.checkout,
        timeoutMs: 900_000,
        env: { ...installEnvironment(), [swarmChildHomeName]: childHome },
      },
    );
    const report = lastJsonLine(ran.stdout.toString(), "swarm.check.v1");
    if (report === null)
      return verdict(
        false,
        `the product's check printed no swarm.check.v1 report (exit ${ran.exitCode}):\n${tail(ran)}`,
      );
    const tests = (report.conclusions?.checks ?? []).find((one) => one.id === "tests") ?? null;
    const effective = tests?.command ?? null;
    const status = tests?.status ?? null;
    const extra = { effective, status, bundleDirectory: report.bundleDirectory ?? null };
    if (tests === null)
      return verdict(false, "the product's check reports no tests gate at all", extra);
    // A vouched rewrite keeps the command and adds the harness's own flags after it.
    if (effective !== expected && !(effective ?? "").startsWith(`${expected} `))
      return verdict(
        false,
        `the product's effective tests gate is ${JSON.stringify(effective)}, not the task's ${JSON.stringify(expected)}`,
        extra,
      );
    if (status !== "passed")
      return verdict(
        false,
        `the product's tests gate (${effective}) is ${status} on the prepared base under the launch's child HOME: ${tests.detail}${tests.output ? `\n${tests.output}` : ""}`,
        extra,
      );
    return verdict(
      true,
      `the product runs ${effective} as its blocking tests gate and it passes on the base; the override was read back by ${pinnedParser ? "the pinned build's parser" : "the TOML library the product parses with"}`,
      extra,
    );
  } finally {
    rmSync(tree.scratch, { recursive: true, force: true });
  }
}

/** The last line of a stream that parses as JSON with the named schema, or null. */
function lastJsonLine(text, schema) {
  for (const line of text.split("\n").reverse()) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.schema === schema) return parsed;
    } catch {}
  }
  return null;
}

/** A hidden test file's bytes at the sealed upstream commit, read from the mirror. */
export function sealedFile(log, task, upstream, path) {
  const mirror = mirrorOf(task.repository);
  return log.run(["git", "show", `${upstream}:${path}`], { cwd: mirror, timeoutMs: 60_000 });
}

/** The paths a patch touches, from its headers. */
export function patchedPaths(patch) {
  const paths = new Set();
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) paths.add(header[2]);
  }
  return [...paths].sort();
}

/** A value inside a parsed manifest by dotted path, or undefined. */
const valueAt = (object, path) =>
  path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);

/**
 * `executeEmpty` runs the oracle over the base tree even where nothing was changed. The
 * short-circuit above it is right for a launch (an unchanged tree is a failed task), but as a
 * control it establishes nothing: a validator that reads "the final tree is the base" has not
 * shown that the hidden tests reject the missing behaviour, only that the scorer refuses an
 * empty patch. Validation asks for the execution and labels the control by what it ran.
 */
export async function hiddenVerdict(
  log,
  task,
  base,
  upstream,
  patch,
  { executeEmpty = false } = {},
) {
  if (patch.trim() === "" && task.workType !== "refactor" && !executeEmpty)
    return {
      verdict: "fail",
      basis: "the final tree is the base: nothing was changed",
      detail: "",
    };
  const allowed = task.hidden.allowedPaths;
  if (allowed !== undefined) {
    // A sealed test file is overlaid at scoring time whatever the patch did to it, so an edit
    // there is discarded rather than judged; the reference's own test changes pass through here
    // the same way.
    const outside = patchedPaths(patch).filter(
      (path) => !allowed.includes(path) && !task.hidden.testFiles.includes(path),
    );
    if (outside.length > 0)
      return {
        verdict: "fail",
        basis: `the patch touches ${outside.join(", ")}; this task authorizes changes to ${allowed.join(", ")} only`,
        detail: "",
      };
  }
  const tree = await freshTree(log, task, base, patch, "hidden");
  try {
    if (!tree.prepared.ok)
      return {
        verdict: tree.prepared.failed[0] === "git" ? "unjudgeable" : "fail",
        basis:
          tree.prepared.failed[0] === "git"
            ? "the patch does not apply to the base"
            : `the candidate's dependencies or build do not prepare: ${tree.prepared.failed.join(" ")}`,
        detail: tree.prepared.detail,
      };
    const details = [];
    for (const path of task.hidden.testFiles) {
      const shown = await sealedFile(log, task, upstream, path);
      if (shown.exitCode !== 0)
        return {
          verdict: "unjudgeable",
          basis: `sealed file ${path} is not at the upstream commit`,
          detail: tail(shown),
        };
      const target = join(tree.checkout, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, shown.stdout);
    }
    // Acceptance checks written for this task, held outside both arms' workspaces until now.
    for (const file of task.hidden.files ?? []) {
      const target = join(tree.checkout, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.source);
    }
    for (const argv of task.build) {
      const built = await run(log, tree.checkout, argv);
      if (built.exitCode !== 0)
        return {
          verdict: "fail",
          basis: `build ${argv.join(" ")} exited ${built.exitCode}`,
          detail: tail(built),
        };
    }
    const upgrade = task.hidden.upgrade ?? [];
    for (const dependency of upgrade) {
      const lock = JSON.parse(readFileSync(join(tree.checkout, "package-lock.json"), "utf8"));
      const installed = lock.packages?.[`node_modules/${dependency.name}`]?.version;
      if (installed !== dependency.version)
        return {
          verdict: "fail",
          basis: `lockfile resolves ${dependency.name} to ${installed ?? "nothing"}, not ${dependency.version}`,
          detail: "",
        };
      const onDisk = join(tree.checkout, "node_modules", dependency.name, "package.json");
      const present = existsSync(onDisk) ? JSON.parse(readFileSync(onDisk, "utf8")).version : null;
      if (present !== dependency.version)
        return {
          verdict: "fail",
          basis: `installed ${dependency.name} is ${present ?? "absent"}, not ${dependency.version}`,
          detail: "",
        };
      details.push(`${dependency.name} ${dependency.version} locked and installed`);
      // The declaration itself, where the task fixes its spelling: a range that resolves to the
      // right version installs the right version and still is not what was asked for.
      if (dependency.declared !== undefined) {
        const manifest = JSON.parse(readFileSync(join(tree.checkout, "package.json"), "utf8"));
        const inManifest = manifest[dependency.section]?.[dependency.name];
        const inLockRoot = lock.packages?.[""]?.[dependency.section]?.[dependency.name];
        for (const [where, found] of [
          ["package.json", inManifest],
          ["the lockfile's root package entry", inLockRoot],
        ])
          if (found !== dependency.declared)
            return {
              verdict: "fail",
              basis: `${where} declares ${dependency.name} as ${JSON.stringify(found ?? null)}, not exactly ${JSON.stringify(dependency.declared)}`,
              detail: "",
            };
        details.push(
          `${dependency.name} declared exactly ${dependency.declared} in package.json and the lockfile root`,
        );
      }
    }
    // Manifest fields the task says must stay as the base had them, compared with the base's
    // own package.json read from the mirror.
    for (const path of task.hidden.unchanged ?? []) {
      const shown = await sealedFile(log, task, base, "package.json");
      if (shown.exitCode !== 0)
        return {
          verdict: "unjudgeable",
          basis: "package.json is not at the base commit",
          detail: tail(shown),
        };
      const before = valueAt(JSON.parse(shown.stdout.toString()), path);
      const after = valueAt(
        JSON.parse(readFileSync(join(tree.checkout, "package.json"), "utf8")),
        path,
      );
      if (JSON.stringify(before) !== JSON.stringify(after))
        return {
          verdict: "fail",
          basis: `package.json ${path} changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}; the task requires it unchanged`,
          detail: "",
        };
      details.push(`package.json ${path} unchanged`);
    }
    for (const structural of task.hidden.structural ?? []) {
      const text = structural.files
        .map((file) =>
          existsSync(join(tree.checkout, file))
            ? readFileSync(join(tree.checkout, file), "utf8")
            : "",
        )
        .join("\n");
      const count = (text.match(new RegExp(structural.pattern, "g")) ?? []).length;
      if (count !== structural.count)
        return {
          verdict: "fail",
          basis: `structural: /${structural.pattern}/ occurs ${count} time(s) in ${structural.files.join(", ")}, expected ${structural.count}`,
          detail: "",
        };
      details.push(`structural /${structural.pattern}/ = ${count}`);
    }
    const judged = await run(log, tree.checkout, task.hidden.argv, 1_200_000);
    if (judged.exitCode !== 0)
      return {
        verdict: "fail",
        basis: `hidden tests (${task.hidden.argv.join(" ")}) exited ${judged.exitCode}`,
        detail: tail(judged, 120),
      };
    for (const argv of task.hidden.extraArgv ?? []) {
      const extra = await run(log, tree.checkout, argv);
      if (extra.exitCode !== 0)
        return {
          verdict: "fail",
          basis: `${argv.join(" ")} exited ${extra.exitCode}`,
          detail: tail(extra),
        };
    }
    if (task.hidden.argv.join(" ") !== task.projectTest.join(" ")) {
      const project = await run(log, tree.checkout, task.projectTest, 1_200_000);
      if (project.exitCode !== 0)
        return {
          verdict: "fail",
          basis: `project tests (${task.projectTest.join(" ")}) exited ${project.exitCode}`,
          detail: tail(project),
        };
    }
    return {
      verdict: "pass",
      basis: "hidden tests, project tests and every structural or version requirement passed",
      detail: details.join("\n"),
    };
  } finally {
    rmSync(tree.scratch, { recursive: true, force: true });
  }
}
