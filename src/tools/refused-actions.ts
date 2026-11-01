import type { SimpleShellCommand } from "./shell-command.ts";

/** Git's own options that take the next word as their value, before the subcommand. */
const gitValueOptions = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

/** Subcommands that publish what the workspace holds to somewhere else, by program. */
const publishing: Readonly<Record<string, readonly string[]>> = {
  git: ["push", "send-email"],
  npm: ["publish", "unpublish", "deprecate", "dist-tag", "owner", "access"],
  pnpm: ["publish"],
  yarn: ["publish", "npm"],
  cargo: ["publish", "yank", "owner"],
  uv: ["publish"],
  poetry: ["publish"],
  twine: ["upload"],
};

/** The subcommand after a program's leading options, and where it stands. */
function subcommand(words: readonly string[], from: number): { name: string; at: number } | null {
  for (let at = from; at < words.length; at += 1) {
    const word = words[at] ?? "";
    if (gitValueOptions.has(word)) at += 1;
    else if (!word.startsWith("-")) return { name: word, at };
  }
  return null;
}

/** Whether a `git stash` invocation, from its words after `stash`, saves the tree away. */
function stashSaves(rest: readonly string[]): boolean {
  const [first] = rest;
  return first === undefined || first === "push" || first === "save" || first.startsWith("-");
}

/**
 * Why a run refuses this command whatever the approval mode, or null. Every word is read as a
 * possible program, so `env X=1 git push` is refused as `git push` is; the reading is lexical,
 * and a program an interpreter starts on its own is the residual the guard names for every
 * allowed interpreter.
 */
export function refusedAction(pipeline: readonly SimpleShellCommand[]): string | null {
  for (const one of pipeline) {
    const words = [one.executable, ...one.arguments];
    for (const [index, word] of words.entries()) {
      const program = word.split("/").at(-1) ?? "";
      const verbs = publishing[program];
      if (verbs === undefined) continue;
      const verb = subcommand(words, index + 1);
      if (verb === null) continue;
      if (verbs.includes(verb.name)) {
        return `\`${program} ${verb.name}\` publishes outside the workspace. A run delivers its change as a patch for the user to publish; nothing it runs pushes or publishes.`;
      }
      if (program === "git" && verb.name === "stash" && stashSaves(words.slice(verb.at + 1))) {
        return "`git stash` moves the change out of the working tree, which is what the verifier judges and the run delivers. To see the base, read a file with `git show HEAD:<path>`; the verifier runs every check at the base and names the failures the change inherited.";
      }
    }
  }
  return null;
}
