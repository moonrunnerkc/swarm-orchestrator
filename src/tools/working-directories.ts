import { isAbsolute, join } from "node:path";
import { pathsACommandCouldOpen } from "./command-operands.ts";
import { readShellStages, type ShellStage } from "./shell-command.ts";

/**
 * The paths a command could open, each written from the directory it would be opened in. A `cd`
 * moves the shell, so after `cd src && cat ../package.json` the file is the workspace's own
 * `package.json`, and after `cd .git && cat config` it is `.git/config`. Read from the workspace
 * root instead, the first was refused as outside the workspace and the second allowed as a file
 * called `config`.
 *
 * Where the shell could be in more than one directory, a path is returned from each, so the guard
 * rules on every file it could be. A stage runs in the directory a `cd` moved to only when `&&`
 * alone joins it to that `cd`; after `;` or `||` the `cd` may not have run or may have failed.
 * The one `cd` that cannot fail is the first command, naming a directory that exists now. A `cd`
 * inside a pipe runs in a subshell and moves nothing. Directories are relative to the root, or
 * absolute where the `cd` named an absolute path; the guard rules on each `cd` target as well.
 *
 * Null where the string cannot be read, or a `cd` goes somewhere this cannot name (`cd -`,
 * `popd`, more than one operand).
 */
export function pathsWhereTheyRun(
  command: string,
  isDirectory: (path: string) => boolean,
): readonly string[] | null {
  const stages = readShellStages(command);
  if (stages === null) return null;
  const pipelines: ShellStage[][] = [];
  for (const stage of stages) {
    if (stage.after === "|") pipelines.at(-1)?.push(stage);
    else pipelines.push([stage]);
  }
  const paths = new Set<string>();
  // Every directory the shell may be in now, and, while only `&&` follows a cd, where it is
  // if the commands so far succeeded.
  let shell: readonly string[] = ["."];
  let chain: readonly string[] | null = null;
  for (const [index, pipeline] of pipelines.entries()) {
    const after = pipeline[0]?.after ?? null;
    const here: readonly string[] = after === "&&" && chain !== null ? chain : shell;
    if (after !== "&&") chain = null;
    for (const stage of pipeline) {
      const opened = pathsACommandCouldOpen(stage);
      if (opened === null) return null;
      for (const path of opened) for (const directory of here) paths.add(from(directory, path));
    }
    const [only] = pipeline;
    if (pipeline.length !== 1 || only === undefined || !movesTheShell(only.executable)) continue;
    const target = destination(only);
    if (target === null) return null;
    const moved: readonly string[] = [...new Set(here.map((directory) => from(directory, target)))];
    const certain = index === 0 && moved.every((directory) => isDirectory(directory));
    shell = certain ? moved : [...new Set([...shell, ...moved])];
    chain = moved;
  }
  return [...paths];
}

const movesTheShell = (executable: string) => ["cd", "pushd", "popd", "chdir"].includes(executable);

/** Where a `cd` or `pushd` goes, or null where it is not one directory this can name. */
function destination(stage: ShellStage): string | null {
  if (stage.executable === "popd") return null;
  const operands: string[] = [];
  let options = true;
  for (const word of stage.arguments) {
    if (options && word === "--") options = false;
    else if (options && /^-[LPe@]+$/.test(word)) continue;
    else if (options && word.startsWith("-")) return null;
    else operands.push(word);
  }
  // `cd` alone goes home.
  if (operands.length === 0) return "~";
  return operands.length === 1 ? (operands[0] ?? null) : null;
}

function from(directory: string, path: string): string {
  if (isAbsolute(path) || path === "~" || path.startsWith("~/") || directory === ".") return path;
  return join(directory, path);
}
