import { parse } from "smol-toml";
import { z } from "zod";
import type { ManifestReader } from "./project-type.ts";

export interface ProjectEnvironment {
  readonly nodeManager?: "npm" | "pnpm";
  readonly nodeManagerVersion?: string;
  readonly pythonCommand?: string;
  readonly setupProblem?: string;
}
const nodeManifest = z.object({ packageManager: z.string().optional() });

/** Inspect declarations and environment files without executing project setup or scripts. */
export async function detectEnvironment(read: ManifestReader): Promise<ProjectEnvironment> {
  const [manifest, npm, pnpm, uv, venv, pyproject] = await Promise.all([
    read("package.json"),
    read("package-lock.json"),
    read("pnpm-lock.yaml"),
    read("uv.lock"),
    read(".venv/pyvenv.cfg"),
    read("pyproject.toml"),
  ]);
  const found: ProjectEnvironment = {};
  if (manifest !== null) {
    let declared: string | undefined;
    try {
      declared = nodeManifest.parse(JSON.parse(manifest)).packageManager;
    } catch {
      return { setupProblem: "package.json is malformed; repair it before choosing commands" };
    }
    const match = /^(npm|pnpm)@([0-9][^\s]*)$/.exec(declared ?? "");
    if (declared !== undefined && match === null)
      return {
        setupProblem: `unsupported packageManager ${declared}; select npm or pnpm explicitly`,
      };
    if (npm !== null && pnpm !== null && match === null)
      return {
        setupProblem: "both npm and pnpm lockfiles exist; declare packageManager explicitly",
      };
    if (match !== null)
      Object.assign(found, { nodeManager: match[1], nodeManagerVersion: match[2] });
    else if (pnpm !== null) Object.assign(found, { nodeManager: "pnpm" });
  }
  if (uv !== null) Object.assign(found, { pythonCommand: "uv run --locked --no-sync python -m" });
  else if (venv !== null) Object.assign(found, { pythonCommand: ".venv/bin/python -m" });
  else if (pyproject !== null) {
    try {
      const data = z
        .object({ tool: z.object({ uv: z.unknown().optional() }).optional() })
        .parse(parse(pyproject));
      if (data.tool?.uv !== undefined)
        Object.assign(found, {
          setupProblem:
            "uv project has no uv.lock; create and review its lockfile before verification",
        });
    } catch {
      Object.assign(found, {
        setupProblem: "pyproject.toml is malformed; repair it before verification",
      });
    }
  }
  return found;
}
