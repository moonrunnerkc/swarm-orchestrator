import { readFile } from "node:fs/promises";
import {
  type SecurityClass,
  type SecurityFile,
  securityClasses,
  securityFileSchema,
} from "swarm-verify";

/** Whether one class of obligation bears on a task, and the reason the report gives for it. */
export interface Applicability {
  readonly class: SecurityClass;
  readonly applies: "yes" | "no" | "unknown";
  readonly reason: string;
}

const signals: Readonly<Record<SecurityClass, { readonly task: RegExp; readonly what: string }>> = {
  ownership: {
    task: /\b(?:owner|owners|owned|owns|their own|belongs? to|per[- ]user|authenticated|authori[sz]\w*|permissions?|roles?|private|another user|other users?)\b/i,
    what: "a resource that belongs to one user",
  },
  "single-use-token": {
    task: /\b(?:tokens?|password reset|reset (?:link|password)|invit\w+|magic link|one[- ]time|single[- ]use|redeem\w*|vouchers?|coupons?|verification (?:code|link)|otp)\b/i,
    what: "a token, link or code that is redeemed",
  },
  "duplicate-operation": {
    task: /\b(?:pay|pays|payments?|charges?|refunds?|transfers?|withdraw\w*|purchases?|checkout|idempoten\w*|exactly once|only once|duplicates?|replay\w*)\b/i,
    what: "an operation that must not be applied twice",
  },
};
const handler =
  /\b(?:endpoints?|routes?|api|requests?|GET|POST|PUT|PATCH|DELETE|downloads?|uploads?|handlers?)\b/;

/**
 * Which of the supported obligations bear on a task, each with the reason, from the task's words
 * and the repository alone. A project with no HTTP API gets none; a class the task does not
 * touch is excluded with why. Where the task changes a request handler and its wording does not
 * say whether what it serves belongs to one user, ownership is unknown, never quietly excluded:
 * the caller settles it before anything is built.
 */
export function securityApplicability(input: {
  readonly task: string;
  readonly api: string | null;
  readonly forced: readonly string[];
  readonly excluded: readonly string[];
}): Applicability[] {
  return securityClasses.map((name): Applicability => {
    const signal = signals[name];
    const word = signal.task.exec(input.task)?.[0];
    if (input.forced.includes(name))
      return { class: name, applies: "yes", reason: "the user said it applies (--security)" };
    if (input.excluded.includes(name))
      return { class: name, applies: "no", reason: "excluded by the user (--no-security)" };
    if (input.api === null)
      return {
        class: name,
        applies: "no",
        reason:
          "this repository holds no HTTP API the supported checks can drive (no server framework among its dependencies and no route in its JavaScript or TypeScript sources)",
      };
    if (word !== undefined)
      return {
        class: name,
        applies: "yes",
        reason: `the task names ${signal.what} ("${word}"), and the repository holds an HTTP API (${input.api})`,
      };
    if (name === "ownership" && handler.test(input.task))
      return {
        class: name,
        applies: "unknown",
        reason:
          "the task changes a request handler, and its wording does not say whether what it serves belongs to one user",
      };
    return { class: name, applies: "no", reason: `the task does not name ${signal.what}` };
  });
}

/** A binding file the user wrote or reviewed, validated; the message says what to correct. */
export async function readSecurityFile(path: string): Promise<SecurityFile> {
  const text = await readFile(path, "utf8");
  const parsed = securityFileSchema.safeParse(JSON.parse(text));
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new Error(
    `${path}: ${issue?.path.join(".") || "file"} ${issue?.message ?? "is not valid"}`,
  );
}
