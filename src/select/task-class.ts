/**
 * The strata the golden set is built from, and the arms the router keeps separate. Four is a
 * deliberate floor: a bandit splits its samples across arms, and finer classes would starve
 * every one of them.
 */
export const taskClasses = ["edit", "multi-file", "test-fix", "tool-heavy"] as const;

export type TaskClass = (typeof taskClasses)[number];

interface TaskClassification {
  readonly taskClass: TaskClass;
  /** The rule that fired, so a routing record explains which arm it reached for and why. */
  readonly rule: string;
}

interface ClassRule {
  readonly taskClass: TaskClass;
  readonly rule: string;
  readonly matches: (task: string) => boolean;
}

/**
 * Keyword matching, and named as such wherever it surfaces. It steers routing and nothing
 * else: a class is never a verdict, so a wrong reading costs an arm's accuracy rather than
 * turning anything green. Ordered most specific first, and the first match wins.
 */
const rules: readonly ClassRule[] = [
  {
    taskClass: "test-fix",
    rule: "the task names tests and names them being broken or made to pass",
    matches: (task) =>
      /\b(test|tests|spec|specs|suite)\b/.test(task) &&
      /\b(fix|fixing|fail|fails|failing|failed|broken|green|repair|passing)\b/.test(task),
  },
  {
    taskClass: "multi-file",
    rule: "the task describes a sweep over more than one place",
    matches: (task) =>
      /\b(across|every|all|throughout|each|everywhere|codebase|tree|repo|repository)\b/.test(
        task,
      ) || /\b(rename|refactor|migrate|migration|port)\b/.test(task),
  },
  {
    taskClass: "tool-heavy",
    rule: "the task asks a question about the code before changing any of it",
    matches: (task) =>
      /\b(find|search|grep|locate|investigate|audit|survey|trace|why|where|which|how)\b/.test(task),
  },
];

const fallbackRule = "nothing more specific matched, so it is read as an ordinary edit";

export function classifyTask(task: string): TaskClassification {
  const normalized = task.toLowerCase();
  for (const rule of rules) {
    if (rule.matches(normalized)) {
      return { taskClass: rule.taskClass, rule: rule.rule };
    }
  }
  return { taskClass: "edit", rule: fallbackRule };
}
