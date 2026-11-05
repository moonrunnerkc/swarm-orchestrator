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
  "Then, for a fix, a feature or other: one fenced block opened with ```test holding the whole",
  "test file. It is laid at the path given below, beside the example test, so import the code the",
  "way the example does. One test per behavior the task states, using the task's own names,",
  "values, orders and messages. Test only what the task states; where it says an error names",
  "something, check that the message contains it, not the exact wording.",
  "",
  "For a refactor: one fenced block opened with ```claims holding a JSON array of structure",
  "claims about files the task names. Each is one of:",
  '  {"path": "a/file.py", "contains": "def moved_name("}                 the file holds the text',
  '  {"path": "a/file.py", "contains": "def moved_name(", "absent": true}  the text left the file',
  "Name each definition the task moves twice: present in the new file, absent from the old one.",
  "",
  "For an upgrade: the kind line alone. The versions are read from the task's wording by code.",
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
