import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type Requirement, requirementSchema } from "swarm-verify";
import { gitText } from "./git.ts";

type Claim = Requirement["evidence"]["structure"][number];

/**
 * A check the user supplied with `--accept` or `--accept-cmd`: the requirement it witnesses (R1
 * unless named, null for `keep=`, a behavior-preservation check that witnesses no requirement), and
 * a test file laid at its repository path, structure claims, or a command.
 */
export type Supplied =
  | {
      readonly kind: "file";
      readonly requirement: string | null;
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly kind: "claims";
      readonly requirement: string;
      readonly source: string;
      readonly claims: readonly Claim[];
    }
  | { readonly kind: "command"; readonly requirement: string | null; readonly command: string };

export class SuppliedCheckError extends Error {
  constructor(detail: string) {
    super(`a supplied check was refused: ${detail}`);
    this.name = "SuppliedCheckError";
  }
}

/** `R2=path`, `keep=path` or a bare path, which witnesses R1. */
function target(spec: string): { readonly requirement: string | null; readonly value: string } {
  const named = /^(R\d+|keep)=(.+)$/s.exec(spec);
  if (named === null) return { requirement: "R1", value: spec };
  return { requirement: named[1] === "keep" ? null : (named[1] ?? "R1"), value: named[2] ?? "" };
}

const skipped = new Set([".git", "node_modules", ".venv", "__pycache__"]);

async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}

const claimList = requirementSchema.shape.evidence.unwrap().shape.structure;

/** Structure claims, where the file is a JSON array of them; null where it is not JSON at all. */
export function claimsIn(text: string, source: string): Claim[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const claims = claimList.safeParse(parsed);
  if (!claims.success || claims.data.length === 0)
    throw new SuppliedCheckError(
      `${source} is JSON but not an array of structure claims ({"path", "contains"|"absent"|"symbol"...})`,
    );
  return claims.data.map((claim) => ({ ...claim, authority: "user-acceptance" as const }));
}

/**
 * Reads what `--accept` and `--accept-cmd` name, before the run opens its workspace, so the
 * workspace can be seeded without them. A file inside the repository is laid at its own path; a
 * directory outside it lays each file at its path under the directory. A file the repository
 * already holds as committed is refused: the model could read it.
 */
export async function readSupplied(input: {
  readonly repository: string;
  readonly cwd: string;
  readonly files: readonly string[];
  readonly commands: readonly string[];
}): Promise<Supplied[]> {
  const supplied: Supplied[] = [];
  const inside = (path: string) => {
    const from = relative(input.repository, path);
    return from.length > 0 && !from.startsWith("..") && !isAbsolute(from) ? from : null;
  };
  for (const spec of input.files) {
    const { requirement, value } = target(spec);
    const absolute = resolve(input.cwd, value);
    const found = await stat(absolute).catch(() => null);
    if (found === null) throw new SuppliedCheckError(`${value} does not exist`);
    const listed = found.isDirectory() ? await filesUnder(absolute) : [absolute];
    if (listed.length === 0) throw new SuppliedCheckError(`${value} holds no file`);
    for (const file of listed) {
      const content = await readFile(file, "utf8");
      const claims = file.endsWith(".json") ? claimsIn(content, file) : null;
      if (claims !== null) {
        if (requirement === null)
          throw new SuppliedCheckError(
            `${file}: structure claims witness a requirement, not keep=`,
          );
        supplied.push({ kind: "claims", requirement, source: file, claims });
        continue;
      }
      const path =
        inside(file) ??
        (found.isDirectory() ? relative(absolute, file).split(sep).join("/") : null);
      if (path === null)
        throw new SuppliedCheckError(
          `${file} is outside the repository: pass the directory that holds it at its repository path`,
        );
      const committed = await gitText(input.repository, ["show", `HEAD:${path}`]).catch(() => null);
      if (committed !== null && committed === content.trim())
        throw new SuppliedCheckError(
          `${path} is the repository's own file as committed, which the model reads; supply a new file or your changed copy`,
        );
      supplied.push({ kind: "file", requirement, path: path.split(sep).join("/"), content });
    }
  }
  for (const spec of input.commands) {
    const { requirement, value } = target(spec);
    if (value.trim().length === 0) throw new SuppliedCheckError("--accept-cmd needs a command");
    supplied.push({ kind: "command", requirement, command: value });
  }
  return supplied;
}

/** The repository paths the supplied files are laid at, which the run's workspace is seeded without. */
export const suppliedPaths = (supplied: readonly Supplied[]): string[] =>
  supplied.flatMap((one) => (one.kind === "file" ? [one.path] : []));
