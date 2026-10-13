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
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  installEnvironment,
  mirrorOf,
  prepare,
  tail,
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

/** A hidden test file's bytes at the sealed upstream commit, read from the mirror. */
export function sealedFile(log, task, upstream, path) {
  const mirror = mirrorOf(task.repository);
  return log.run(["git", "show", `${upstream}:${path}`], { cwd: mirror, timeoutMs: 60_000 });
}

export async function hiddenVerdict(log, task, base, upstream, patch) {
  if (patch.trim() === "" && task.workType !== "refactor")
    return {
      verdict: "fail",
      basis: "the final tree is the base: nothing was changed",
      detail: "",
    };
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
