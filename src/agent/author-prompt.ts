import type { Requirement } from "swarm-verify";
import type { TestConventions } from "./test-conventions.ts";

export const authorKinds = ["fix", "feature", "refactor", "upgrade", "other"] as const;
export type AuthorKind = (typeof authorKinds)[number];

export const authorPrompt = [
  "You write the acceptance checks for a change another engineer is about to make. You never see",
  "their change. You see the task as the user wrote it and how this repository writes its tests.",
  "Your checks decide whether the work is done, so they must fail on the repository as it is now",
  "and pass once the task is done exactly as written.",
  "",
  "First line of your reply: `kind: <fix|feature|refactor|upgrade|other>`, what the task is.",
  "- fix: behavior that is wrong now and the task says how it should be.",
  "- feature: new behavior: an option, a function, a field, an output.",
  "- refactor: code moves or is restructured and behavior stays the same.",
  "- upgrade: dependencies move to new versions, with what that needs.",
  "",
  "Then, for a fix, a feature or other: first list, as comments at the top of the test file,",
  "every behavior the task states, each function, option, module or message it names; then one",
  "test for each item on the list. A behavior the list leaves out is one nobody checks.",
  "One fenced block opened with ```test holds the whole",
  "test file. It is laid at the path given below, beside the example test, so import the code the",
  "way the example does. One test per behavior the task states, using the task's own names,",
  "values, orders and messages. Test only what the task states, and nothing about form it does not",
  "state: where it says a message names some things, check that it contains each of them, one",
  "by one, never their joining words, punctuation or order; where it says an error happens,",
  "check that it throws and names what the task says it names.",
  "While your test runs, it and the change are uncommitted files in the working tree, it may be",
  "judged in a container with only the repository's own dependencies (no tools or programs from",
  "this machine), and no credentials or keys are set. Where the code checks such things before doing",
  "the work (a clean tree, a key, a program on PATH, a config file), mock what the repository's own",
  "tests mock where they call the same code, or test the function that does the work; a check",
  "the code refuses to run fails on every tree. Where a case drives the code through setup of its",
  "own (mocks, a repository, a home, arguments, keys), add a case titled `control: ...` (in Python",
  "`test_control_...`) that drives behavior that succeeds now through the same setup, such as the",
  "same call without the new option, and asserts the work was reached (the mocked call made, the",
  "result returned); the harness runs it before the change, and a control that fails, or makes the",
  "code print an error, shows the setup does not reach the code.",
  "",
  "For a refactor: one fenced block opened with ```claims holding a JSON array of structure",
  "claims about the modules the task names, read by the language's own parser. Each is one of:",
  '  {"path": "a/new.py", "symbol": "moved_name"}                    the module defines the name',
  '  {"path": "a/old.py", "symbol": "moved_name", "absent": true}    the module no longer defines it',
  '  {"path": "a/old.py", "symbol": "moved_name", "provides": true}  an importer still gets it there',
  '  {"path": "a/pkg/__init__.py"}                                    the file exists',
  '  {"path": "tests/test_old.py", "absent": true}                    the file is gone',
  "Paths are the repository's own, from its root, as the definitions below show where code lives;",
  "where the task's wording names a path the repository does not have, use the repository's.",
  "Claim a name only where the module defines it itself (def, class, an assignment), not where it",
  "imports it. Name a new file only where the wording names it: where it says to move files into a",
  "package or directory, the names inside are the mover's choice, so claim the package's file",
  "exists and the old file is gone or still provides each name. Where the wording names the new",
  "module, name each definition it moves twice: defined in the new module, no longer defined in",
  "the old one; where the task says old imports keep working, add a provides claim for each name.",
  "",
  "For an upgrade: the kind line; the versions are read from the task's wording by code. Where the",
  "task also asks for code to change with them (a version it installs, a call it adapts), add one",
  "```test block for that behavior, as for a feature.",
].join("\n");

/** What the author is shown: the requirement as recorded, and the repository's conventions. */
export function authorRequest(
  requirement: Requirement,
  conventions: TestConventions | null,
): string {
  const assumptions =
    requirement.assumptions.length === 0 ? "none" : requirement.assumptions.join("; ");
  const head = [
    `Task (${requirement.id}, as the user wrote it):`,
    requirement.text,
    "",
    `Assumptions recorded: ${assumptions}`,
    "",
  ];
  if (conventions === null)
    return [
      ...head,
      "No test runner was recognized in this repository, so no test file can run here.",
    ].join("\n");
  return [
    ...head,
    `Test runner: ${conventions.runner}; test files live under: ${conventions.roots.join(", ")}`,
    `Your test file is laid at: ${conventions.pathFor(requirement.id)}`,
    `and run with: ${conventions.commandFor(conventions.pathFor(requirement.id))}`,
    "",
    "Where the names the task uses are defined now (import them from these modules):",
    ...(conventions.definitions.length === 0
      ? ["- none of them is defined yet"]
      : conventions.definitions.map(
          (one) => `- ${one.name}: ${one.path}:${one.line}: ${one.text}`,
        )),
    "A module or name the task asks for that is not listed does not exist yet.",
    "",
    ...conventions.named.flatMap((file) => [
      `${file.path}, as the base has it (imports and declarations, no bodies):`,
      "```",
      ...file.outline,
      "```",
    ]),
    ...(conventions.named.length === 0 ? [] : [""]),
    `Example test from this repository (${conventions.example.path}):`,
    "```",
    conventions.example.content,
    "```",
  ].join("\n");
}

export type ParsedAuthor =
  | {
      readonly kind: AuthorKind;
      readonly test: string | null;
      readonly claims: readonly unknown[] | null;
      readonly problem: string | null;
    }
  | { readonly kind: null; readonly problem: string };

const fence = /```([\w-]*)[ \t]*\n([\s\S]*?)\n?```/g;

/** The kind, the test file and the claims an author's reply holds, or why it holds none. */
export function parseAuthor(reply: string): ParsedAuthor {
  const kind = /^\s*`?kind:\s*(fix|feature|refactor|upgrade|other)\b/im.exec(reply)?.[1];
  if (kind === undefined)
    return { kind: null, problem: "the reply has no `kind: <fix|feature|...>` line" };
  const blocks = [...reply.matchAll(fence)].map((match) => ({
    lang: (match[1] ?? "").toLowerCase(),
    body: match[2] ?? "",
  }));
  const claimBlock = blocks.find((one) => one.lang === "claims" || one.lang === "json");
  const testBlock =
    blocks.find((one) => one.lang === "test") ??
    blocks.find((one) => one !== claimBlock && one.body.trim().length > 0);
  let claims: unknown[] | null = null;
  let problem: string | null = null;
  if (claimBlock !== undefined) {
    try {
      const parsed: unknown = JSON.parse(claimBlock.body);
      claims = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      problem = `the claims block is not JSON: ${(error as Error).message}`;
    }
  }
  const test = testBlock === undefined ? null : `${testBlock.body.trimEnd()}\n`;
  return { kind: kind as AuthorKind, test, claims, problem };
}
