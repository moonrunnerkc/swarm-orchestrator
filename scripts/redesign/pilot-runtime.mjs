import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { createContainerBackend } from "../../src/exec/container-backend.ts";
import { runProcessGroup } from "../../src/exec/run-process.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";

export function projectGateOptions(candidate) {
  if (candidate.repository === "pallets/click")
    return {
      commandOverrides: {
        tests:
          "mkdir -p .tox/swarm-tmp && TMPDIR=/workspace/.tox/swarm-tmp pytest --basetemp=.tox/swarm-tmp/pytest",
      },
    };
  if (candidate.repository === "python-attrs/attrs")
    return {
      commandOverrides: {
        typecheck:
          "mypy typing-examples && mypy src/attrs/__init__.pyi src/attr/__init__.pyi src/attr/_typing_compat.pyi src/attr/_version_info.pyi src/attr/converters.pyi src/attr/exceptions.pyi src/attr/filters.pyi src/attr/setters.pyi src/attr/validators.pyi",
      },
    };
  if (candidate.repository === "tj/commander.js")
    return { commandOverrides: { tests: "npm run test-all" } };
  if (candidate.repository === "jhlywa/chess.js")
    return {
      commandOverrides: {
        tests:
          candidate.id === "jhlywa-chess-js-501"
            ? "npm run check"
            : "npm run parser && npm run check",
      },
    };
  if (candidate.repository === "gvergnaud/ts-pattern")
    return { commandOverrides: { tests: "npm run build && npm test && npm run check" } };
  if (candidate.language !== "python")
    return { commandOverrides: { tests: "npm run build && npm test" } };
  return {};
}

export function runtimeFor({ candidate, workspace, evidence, signal, clock, commandPool }) {
  const isolation =
    candidate.image === null
      ? undefined
      : createContainerBackend({
          runtime: "docker",
          image: candidate.image,
          workspaceRoot: workspace,
          user: `${process.getuid()}:${process.getgid()}`,
          memory: "4g",
          network: candidate.language === "python" ? "none" : "bridge",
          sessionId: evidence.sessionId,
          observeLifecycle: async (event) =>
            evidence.record({
              type: "campaign-observation",
              actor: "harness",
              provenance: ["tool-output"],
              payload: { kind: "runtime-resource", workspace, ...event },
            }),
        });
  return {
    isolation,
    commands: createNodeCommandRunner(
      clock,
      harnessChildEnvironment(),
      isolation,
      signal,
      commandPool,
    ),
  };
}

export async function checkoutBase({ clone, baseCommit, workspace, evidence, signal }) {
  await mkdir(workspace, { mode: 0o700 });
  for (const argv of [
    ["git", "init", "--quiet"],
    ["git", "fetch", "--depth", "1", clone, baseCommit],
    ["git", "checkout", "-b", "swarm-base", "--quiet", "FETCH_HEAD"],
  ]) {
    await evidence.record({
      type: "campaign-observation",
      actor: "harness",
      provenance: ["user"],
      payload: { phase: "checkout-intent", workspace, argv },
    });
    const observed = await runProcessGroup(argv[0], argv.slice(1), {
      cwd: workspace,
      env: harnessChildEnvironment().variables,
      timeoutMs: 30000,
      signal,
      maxOutputBytes: 4000000,
    });
    await evidence.record({
      type: "campaign-observation",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { phase: "checkout-completed", workspace, argv, observed },
    });
    if (observed.exitCode !== 0 || observed.startFailure !== null)
      throw new Error(
        `Cannot check out ${baseCommit}: ${observed.startFailure ?? observed.stderr}`,
      );
  }
  return join(workspace, ".git");
}
