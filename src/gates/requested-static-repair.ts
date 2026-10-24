import { taskSentences } from "./preservation-obligations.ts";

/**
 * Whether the task asks for a static check's failure to be fixed (failure-identity-v5,
 * docs/check-requirements.md). Where it does, "no new regression" would excuse leaving the task's
 * own subject undone, so the gate is sealed `absolute-pass`.
 *
 * A lexical reading, recorded with the sentence that triggered it: one sentence holds a repair
 * verb with no negation before it, followed closely by the gate's name or a tool its command
 * runs. A task that
 * asks for a static repair in other words is not detected, and the gate keeps its default.
 */

const repairVerb =
  /\b(?:fix(?:es|ed|ing)?|resolv(?:e|es|ing)|repair(?:s|ing)?|correct(?:s|ing)?|clean(?:s|ing)? up|get rid of|make\s+(?:[\w`'"./-]+\s+){0,5}pass)\b/i;
const negation =
  /\b(?:do not|don't|does not|doesn't|never|without|no need to|not)\b(?:\s+\S+){0,3}\s*$/i;

/** The words that name each kind of static check, by gate id and by the tool a command runs. */
const namesOf: Readonly<Record<string, RegExp>> = {
  lint: /\b(?:lint(?:ing|er)?|eslint|biome)\b/i,
  format: /\b(?:format(?:ting)?|prettier)\b/i,
  typecheck: /\b(?:type ?check(?:ing)?|type[- ]errors?|tsc|typescript errors?)\b/i,
  build: /\bbuild\b/i,
};

/** The kinds a gate answers to: its own id, and each tool its command names. */
function kindsOf(gateId: string, command: string | null): readonly string[] {
  const base = gateId.split(":")[0] ?? gateId;
  const kinds = new Set<string>(base in namesOf ? [base] : []);
  if (command !== null) {
    if (/\b(?:eslint|biome)\b/.test(command)) kinds.add("lint");
    if (/\bprettier\b/.test(command)) kinds.add("format");
    if (/\btsc\b/.test(command)) kinds.add("typecheck");
  }
  return [...kinds];
}

/**
 * The task sentence that asks for this gate's failure to be fixed, or null where none does.
 */
export function staticRepairRequested(
  task: string | undefined,
  gate: { readonly id: string; readonly command: string | null },
): string | null {
  if (task === undefined) return null;
  const kinds = kindsOf(gate.id, gate.command);
  if (kinds.length === 0) return null;
  for (const sentence of taskSentences(task)) {
    const verb = repairVerb.exec(sentence);
    if (verb === null || negation.test(sentence.slice(0, verb.index))) continue;
    // The check is the verb's object: named within the verb's phrase ("make `npm run lint`
    // pass") or soon after it ("fix the ESLint error"). A name elsewhere in the sentence is about
    // something else: nanoid's "every subpath (format, ...) still resolve" fixes no formatting.
    const object = sentence.slice(verb.index, verb.index + verb[0].length + 60);
    if (kinds.some((kind) => namesOf[kind]?.test(object) === true)) return sentence;
  }
  return null;
}
