import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DeclaredCheck } from "./swarm-toml.ts";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** The script names that mean each check, first match wins. */
const nodeScripts: readonly (readonly [string, readonly string[]])[] = [
  ["test", ["test"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck", "type-check", "check-types", "tsc"]],
  ["build", ["build"]],
];

async function nodeManager(workspace: string): Promise<string> {
  if (await exists(join(workspace, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(workspace, "yarn.lock"))) return "yarn";
  if (await exists(join(workspace, "bun.lock"))) return "bun";
  if (await exists(join(workspace, "bun.lockb"))) return "bun";
  return "npm";
}

async function nodeChecks(workspace: string): Promise<readonly DeclaredCheck[]> {
  let manifest: { scripts?: Record<string, unknown> };
  try {
    manifest = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const scripts = manifest.scripts ?? {};
  const manager = await nodeManager(workspace);
  const checks: DeclaredCheck[] = [];
  for (const [name, candidates] of nodeScripts) {
    const script = candidates.find((candidate) => typeof scripts[candidate] === "string");
    // npm's placeholder test script fails on purpose; it declares no tests.
    if (script === undefined || /no test specified/.test(String(scripts[script]))) continue;
    checks.push({
      name,
      command: `${manager} run ${script}`,
      kind: name === "test" ? "test" : "other",
    });
  }
  return checks;
}

async function pythonChecks(workspace: string): Promise<readonly DeclaredCheck[]> {
  const markers = ["pyproject.toml", "setup.py", "setup.cfg", "pytest.ini", "tox.ini"];
  const found = await Promise.all(markers.map((name) => exists(join(workspace, name))));
  if (!found.some(Boolean)) return [];
  const prefix = (await exists(join(workspace, "uv.lock")))
    ? "uv run"
    : (await exists(join(workspace, ".venv")))
      ? ".venv/bin/python -m"
      : "python3 -m";
  return [{ name: "test", command: `${prefix} pytest -q`, kind: "test" }];
}

/** The checks a project declares through its manifests, Node first. */
export async function detectChecks(workspace: string): Promise<readonly DeclaredCheck[]> {
  const node = await nodeChecks(workspace);
  return node.length > 0 ? node : pythonChecks(workspace);
}

export function renderSwarmToml(checks: readonly DeclaredCheck[]): string {
  const lines = ["# Written by swarm init. The verifier runs each check in a clean checkout.", ""];
  lines.push("[checks]");
  for (const check of checks) {
    const kind = check.kind === "test" && check.name !== "test" ? ', kind = "test"' : "";
    lines.push(
      kind === ""
        ? `${check.name} = ${JSON.stringify(check.command)}`
        : `${check.name} = { command = ${JSON.stringify(check.command)}${kind} }`,
    );
  }
  return `${lines.join("\n")}\n`;
}
