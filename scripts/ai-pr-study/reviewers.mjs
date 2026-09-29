/**
 * The two reviewers of the task-truth arm, what each is shown, and how their judgements and the
 * executed checks combine into a row's truth.
 *
 * The check author (first reviewer) sees the pull request's title, body and linked issues, the
 * names of the files it changed, and a read-only checkout of the BASE commit: never the
 * candidate implementation. It states the requirements and writes checks per requirement (two
 * or more where the requirement admits it), each recorded with the requirement text and the
 * words of the pull request it comes from.
 *
 * The second reviewer is a different local model. It first states the requirements and task
 * type from the pull request's text alone, blind to the first reviewer, and then judges each of
 * the first reviewer's requirements (stated by the text or not) and each check (a valid test of
 * its requirement or not), with an explicit `uncertain` for abstention.
 *
 * Both reviewers are AI models, not independent humans. Neither authored the pull request, but
 * they may share training biases with each other and with the model that did.
 *
 * A requirement is scored only where the second reviewer agrees it is stated, at least one check
 * both reviewers accept executed validly, and every such check agrees. A row is scored only when
 * no decision-relevant disagreement remains; every other case is unscored with its reason.
 */
import { sha256 } from "./attempts.mjs";
import { TASK_TYPES } from "./side-outcome.mjs";

export const reviewerDisclosure =
  "Both reviewers are AI models, not independent humans. Neither authored the pull request, but they may share training biases with each other and with the model that did.";

/** The pull request's stated requirement, as both reviewers are shown it. */
export function pullRequestText(pr) {
  return [
    `Repository: ${pr.repository}`,
    `Pull request #${pr.number}: ${pr.title}`,
    "",
    "Body:",
    pr.body || "(empty)",
    ...(pr.linkedIssues ?? []).flatMap((issue) => [
      "",
      `Linked issue #${issue.number}: ${issue.title}`,
      issue.body || "(empty)",
    ]),
  ].join("\n");
}

export const authorSystem = [
  "You are a reviewer establishing whether a merged pull request did what it claims, independently of its implementation and its tests.",
  "You are given the pull request's title, body and linked issues, the names of the files it changed, and tools to read the repository at the pull request's BASE commit, before the change. You never see the changed code; write checks from the stated requirement and the public interfaces the text and the base code describe.",
  "State each requirement the text makes, in one or two sentences, with the exact words of the pull request it comes from. For each requirement write executable acceptance checks: at least two independent checks where the requirement admits it (different inputs, or different observable consequences), and say why when only one is possible.",
  "Each check is a new file (a path that does not exist at the base and that the pull request did not change) and one shell command run from the repository root; several checks may share one file (for example separate test functions selected by the command) only if every one of them gives that file identical contents. Commands use only what the repository installs (its test runner, or plain `node --test` / `python -m pytest`). Checks run with the network off. Prefer checks that import and exercise the project's code over checks that read source text.",
  "A check must fail on the base when the requirement is unmet there and pass when it is met. For a bug fix or feature, it fails before and passes after. For a refactor, write equivalence checks that pin behaviour which must be the same before and after (they pass on both). For a dependency upgrade, check the upgraded version or the behaviour it enables. For an API or browser change that needs a network service or a browser, say so in `needs`.",
  "If the requirement cannot be stated as an executable check (documentation only, or it needs a service you cannot reach), call finish with unjudged=true and say why. Never guess.",
  "Act by calling tools: `list` a directory, `read` a file, then `finish`. Keep reads purposeful.",
].join("\n");

export const authorTools = [
  {
    type: "function",
    function: {
      name: "list",
      description: "List a directory of the repository at the base commit.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file of the repository at the base commit.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Hand over the requirements and their checks, or say they are not executable.",
      parameters: {
        type: "object",
        properties: {
          unjudged: { type: "boolean" },
          reason: { type: "string" },
          taskType: { type: "string", enum: TASK_TYPES },
          needs: { type: "array", items: { type: "string", enum: ["network", "browser"] } },
          requirements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "R1, R2, ..." },
                text: { type: "string" },
                quote: {
                  type: "string",
                  description: "verbatim words of the pull request this requirement comes from",
                },
                singleCheckReason: { type: "string" },
                checks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                      contents: { type: "string" },
                      command: { type: "string" },
                      asserts: { type: "string", description: "what the check asserts" },
                    },
                    required: ["path", "contents", "command", "asserts"],
                  },
                },
              },
              required: ["id", "text", "quote", "checks"],
            },
          },
        },
        required: ["unjudged", "reason"],
      },
    },
  },
];

export const blindSystem =
  "You read a pull request's title, body and linked issues and state, independently, what it requires. You see no code. List each requirement in one or two sentences with the exact words of the pull request it comes from, and the task type. If the text states nothing executable (documentation only, or it needs a service), say so. Call the state tool once.";

export const blindTools = [
  {
    type: "function",
    function: {
      name: "state",
      description: "State the requirements and the task type.",
      parameters: {
        type: "object",
        properties: {
          taskType: { type: "string", enum: TASK_TYPES },
          executable: { type: "boolean" },
          reason: { type: "string" },
          requirements: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, quote: { type: "string" } },
              required: ["text", "quote"],
            },
          },
        },
        required: ["taskType", "executable", "requirements"],
      },
    },
  },
];

export const judgeSystem = [
  "You are the second, independent reviewer of a pull request's acceptance checks. Another reviewer, who saw only the base code, stated requirements and wrote checks. You see the pull request's text, your own earlier statement of its requirements, and the other reviewer's requirements and checks.",
  "For each requirement: is it stated by the pull request's text? Answer yes, no, or uncertain, with the reason.",
  "For each check: is it a valid test of its requirement, one that would fail if the requirement were unmet and pass if met, without asserting anything the text does not state? Answer valid, invalid, or uncertain, with the reason. Say uncertain whenever you cannot tell; never guess.",
  "List any requirement from your own statement that the other reviewer's requirements do not cover, and say whether you agree with the task type. Call the judge tool once.",
].join("\n");

export const judgeTools = [
  {
    type: "function",
    function: {
      name: "judge",
      description: "Judge each requirement and each check.",
      parameters: {
        type: "object",
        properties: {
          requirements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                stated: { type: "string", enum: ["yes", "no", "uncertain"] },
                reason: { type: "string" },
              },
              required: ["id", "stated", "reason"],
            },
          },
          checks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "the check's id as shown" },
                valid: { type: "string", enum: ["valid", "invalid", "uncertain"] },
                reason: { type: "string" },
              },
              required: ["id", "valid", "reason"],
            },
          },
          uncovered: { type: "array", items: { type: "string" } },
          taskType: { type: "string", enum: TASK_TYPES },
        },
        required: ["requirements", "checks", "uncovered", "taskType"],
      },
    },
  },
];

export const traceSystem =
  "You audit an acceptance check against a pull request's stated requirement. You see only the requirement text and the check's failing output. For each failing assertion, quote the exact words of the requirement that state it. If any failing assertion is not stated in the requirement (it is an inference, a style preference or a stricter reading than the text), set traceable to false. Call the trace tool once.";

export const traceTools = [
  {
    type: "function",
    function: {
      name: "trace",
      description: "Map each failing assertion to the requirement sentence it comes from.",
      parameters: {
        type: "object",
        properties: {
          traceable: { type: "boolean" },
          mapping: {
            type: "array",
            items: {
              type: "object",
              properties: { assertion: { type: "string" }, quote: { type: "string" } },
              required: ["assertion", "quote"],
            },
          },
        },
        required: ["traceable", "mapping"],
      },
    },
  },
];

/** A digest over a role's system prompt and tool schema: what the model was asked, exactly. */
export function promptDigest(system, tools) {
  return sha256(JSON.stringify({ system, tools }));
}

/**
 * The harness's own check of a trace audit: the model's word is not enough, every quote must
 * appear verbatim in the requirement text.
 */
export function traceHolds(parsed, requirementText) {
  const mapping = Array.isArray(parsed?.mapping) ? parsed.mapping : [];
  const quotesHold =
    mapping.length > 0 &&
    mapping.every(
      (entry) =>
        typeof entry.quote === "string" &&
        entry.quote.trim().length > 0 &&
        requirementText.includes(entry.quote.trim()),
    );
  return { traceable: parsed?.traceable === true && quotesHold, mapping };
}

/**
 * Validate the check author's finish call. Returns `{ refusal }` to send back to the model, or
 * `{ accepted }` with the normalised requirements. `pathRefusal(path)` is the harness's own
 * check of one check path (inside the clone, new at the base, not a changed file).
 */
export function validateAuthorFinish(args, pathRefusal) {
  if (args?.unjudged === true)
    return { accepted: { unjudged: true, reason: String(args.reason ?? "no executable check") } };
  if (!TASK_TYPES.includes(args?.taskType))
    return { refusal: `refused: taskType must be one of ${TASK_TYPES.join(", ")}` };
  const requirements = Array.isArray(args.requirements) ? args.requirements : [];
  if (requirements.length === 0)
    return {
      refusal:
        "refused: state at least one requirement with its checks, or finish with unjudged=true",
    };
  const contentsOf = new Map();
  const normalised = [];
  for (const [position, requirement] of requirements.entries()) {
    const id =
      typeof requirement.id === "string" && requirement.id !== ""
        ? requirement.id
        : `R${position + 1}`;
    const checks = Array.isArray(requirement.checks) ? requirement.checks : [];
    if (typeof requirement.text !== "string" || requirement.text.trim() === "")
      return { refusal: `refused: requirement ${id} has no text` };
    if (checks.length === 0) return { refusal: `refused: requirement ${id} has no check` };
    if (checks.length === 1 && !requirement.singleCheckReason)
      return {
        refusal: `refused: requirement ${id} has one check; write a second independent check, or give singleCheckReason saying why only one is possible`,
      };
    const accepted = [];
    for (const [number, check] of checks.entries()) {
      if (!check.contents || !check.command)
        return { refusal: `refused: a check of ${id} has no contents or no command` };
      const path = pathRefusal(String(check.path ?? ""));
      if (path.refusal !== null) return { refusal: path.refusal };
      // One file may carry several checks, each selected by its own command, only when every
      // check gives it the same bytes: the file is written once for all of them.
      const earlier = contentsOf.get(path.path);
      if (earlier !== undefined && earlier !== String(check.contents))
        return {
          refusal: `refused: ${path.path} is given different contents by two checks; give each its own file, or the same contents`,
        };
      contentsOf.set(path.path, String(check.contents));
      accepted.push({
        id: `${id}.C${number + 1}`,
        path: path.path,
        contents: String(check.contents),
        command: String(check.command),
        asserts: String(check.asserts ?? ""),
        digest: sha256(String(check.contents)),
      });
    }
    normalised.push({
      id,
      text: requirement.text.trim(),
      quote: String(requirement.quote ?? ""),
      singleCheckReason: requirement.singleCheckReason ?? null,
      checks: accepted,
    });
  }
  const needs = Array.isArray(args.needs)
    ? args.needs.filter((need) => ["network", "browser"].includes(need))
    : [];
  return {
    accepted: {
      unjudged: false,
      reason: String(args.reason ?? ""),
      taskType: args.taskType,
      needs,
      requirements: normalised,
    },
  };
}

/**
 * Combine the two reviewers and the executed checks into the row's truth.
 *
 * `author` is the accepted finish; `blind` and `judge` the second reviewer's two answers;
 * `outcomes` maps each check id to `{ decision, reason, truthClass }` after execution and the
 * trace audit (`decision` is met, violated or unjudged). Returns the row's truth with every
 * requirement's standing, the disagreements and the uncertainty.
 */
export function scoreRow({ author, blind, judge, outcomes }) {
  const disagreements = [];
  const uncertainty = [];
  if (author === null || author.unjudged === true) {
    const reason =
      author === null
        ? "the check author produced no finish"
        : `the check author abstained: ${author.reason}`;
    uncertainty.push({ who: "author", about: "row", detail: reason });
    if (blind?.executable === true)
      disagreements.push({
        about: "executable",
        detail: "the second reviewer found an executable requirement where the author abstained",
      });
    return {
      class: "unscored",
      status: null,
      reason,
      requirements: [],
      disagreements,
      uncertainty,
    };
  }
  if (blind === null || judge === null)
    return {
      class: "unscored",
      status: null,
      reason: "the second reviewer produced no judgement",
      requirements: [],
      disagreements,
      uncertainty: [{ who: "second", about: "row", detail: "no judgement" }],
    };
  if (blind.executable === false)
    disagreements.push({
      about: "executable",
      detail: `the second reviewer, blind, found nothing executable: ${blind.reason ?? ""}`,
    });
  const refactorSplit = (author.taskType === "refactor") !== (judge.taskType === "refactor");
  if (author.taskType !== judge.taskType)
    disagreements.push({
      about: "taskType",
      detail: `author ${author.taskType}, second reviewer ${judge.taskType}${refactorSplit ? " (decision-relevant: a refactor is judged by equivalence)" : ""}`,
    });
  const uncovered = (judge.uncovered ?? []).filter((text) => String(text).trim() !== "");
  if (uncovered.length > 0)
    disagreements.push({
      about: "coverage",
      detail: `requirements the author did not state: ${uncovered.join(" | ")}`,
    });
  const standings = author.requirements.map((requirement) => {
    const verdict = (judge.requirements ?? []).find((entry) => entry.id === requirement.id);
    const stated = verdict?.stated ?? "uncertain";
    if (stated === "uncertain")
      uncertainty.push({
        who: "second",
        about: requirement.id,
        detail: verdict?.reason ?? "no judgement",
      });
    if (stated === "no")
      disagreements.push({
        about: requirement.id,
        detail: `not stated by the text: ${verdict?.reason ?? ""}`,
      });
    const checks = requirement.checks.map((check) => {
      const validity = (judge.checks ?? []).find((entry) => entry.id === check.id);
      const valid = validity?.valid ?? "uncertain";
      if (valid === "uncertain")
        uncertainty.push({
          who: "second",
          about: check.id,
          detail: validity?.reason ?? "no judgement",
        });
      if (valid === "invalid")
        disagreements.push({
          about: check.id,
          detail: `check judged invalid: ${validity?.reason ?? ""}`,
        });
      const outcome = outcomes[check.id] ?? {
        decision: "unjudged",
        reason: "not executed",
        truthClass: "unscored",
      };
      return {
        id: check.id,
        path: check.path,
        valid,
        validityReason: validity?.reason ?? null,
        ...outcome,
      };
    });
    const standing = (truthClass) => {
      const usable = checks.filter(
        (check) =>
          check.valid === "valid" &&
          check.decision !== "unjudged" &&
          check.truthClass === truthClass,
      );
      if (stated !== "yes")
        return { status: null, reason: `the second reviewer judged the requirement ${stated}` };
      if (usable.length === 0)
        return { status: null, reason: "no check both reviewers accept executed validly" };
      const decisions = new Set(usable.map((check) => check.decision));
      if (decisions.size > 1) return { status: null, reason: "the accepted checks disagree" };
      return {
        status: usable[0].decision === "met" ? "requirement-met" : "requirement-violated",
        reason: `${usable.length} accepted check(s) agree`,
      };
    };
    return {
      id: requirement.id,
      text: requirement.text,
      stated,
      checks,
      behavioural: standing("behavioural-executed"),
      textInspected: standing("text-inspected"),
    };
  });
  const decide = (key) => {
    if (refactorSplit)
      return { status: null, reason: "the reviewers disagree on whether this is a refactor" };
    if (blind.executable === false)
      return {
        status: null,
        reason: "the reviewers disagree on whether the requirement is executable",
      };
    const violated = standings.filter((entry) => entry[key].status === "requirement-violated");
    if (violated.length > 0)
      return {
        status: "requirement-violated",
        reason: `requirement(s) ${violated.map((entry) => entry.id).join(", ")} violated`,
      };
    const met = standings.filter((entry) => entry[key].status === "requirement-met");
    if (met.length === standings.length && uncovered.length === 0)
      return {
        status: "requirement-met",
        reason: "every requirement met by agreed, validly executed checks",
      };
    if (met.length === standings.length)
      return {
        status: null,
        reason:
          "every stated requirement is met, but the second reviewer names requirements the checks do not cover",
      };
    const open = standings.filter((entry) => entry[key].status === null);
    return {
      status: null,
      reason: `requirement(s) unscored: ${open.map((entry) => `${entry.id} (${entry[key].reason})`).join("; ")}`,
    };
  };
  const behavioural = decide("behavioural");
  if (behavioural.status !== null)
    return {
      class: "behavioural-executed",
      status: behavioural.status,
      reason: behavioural.reason,
      requirements: standings,
      disagreements,
      uncertainty,
    };
  const inspected = decide("textInspected");
  if (inspected.status !== null)
    return {
      class: "text-inspected",
      status: inspected.status,
      reason: `${inspected.reason}; reported apart, not task truth (no behavioural result: ${behavioural.reason})`,
      requirements: standings,
      disagreements,
      uncertainty,
    };
  return {
    class: "unscored",
    status: null,
    reason: behavioural.reason,
    requirements: standings,
    disagreements,
    uncertainty,
  };
}
