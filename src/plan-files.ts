import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan } from './plan-generator';

function getPlanDir(): string {
  return path.join(process.cwd(), 'plans');
}

function ensurePlanDirectory(): string {
  const planDir = getPlanDir();
  if (!fs.existsSync(planDir)) {
    fs.mkdirSync(planDir, { recursive: true });
  }
  return planDir;
}

function generatePlanFilename(plan: ExecutionPlan): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const goalSlug = plan.goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  return `plan-${timestamp}-${goalSlug}.json`;
}

function resolvePlanPath(planRef: string): string {
  if (path.isAbsolute(planRef)) {
    return planRef;
  }

  const looksLikePath = planRef.includes(path.sep) || planRef.startsWith('./') || planRef.startsWith('../');
  if (looksLikePath) {
    return path.resolve(process.cwd(), planRef);
  }

  // Bare filename: prefer the file in cwd if it exists, otherwise fall back
  // to the workspace plans/ directory. This matches the help text examples
  // (`swarm swarm plan.json`) without breaking the historical `plans/<name>`
  // shortcut.
  const cwdCandidate = path.resolve(process.cwd(), planRef);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  return path.join(getPlanDir(), planRef);
}

/**
 * Writes an execution plan JSON file under the current workspace plans directory.
 *
 * @param plan - Plan to persist.
 * @param filename - Optional filename. When omitted, a timestamped filename is generated.
 * @returns Absolute path to the written plan file.
 */
export function savePlanFile(plan: ExecutionPlan, filename?: string): string {
  const planDir = ensurePlanDirectory();
  const planFilename = filename || generatePlanFilename(plan);
  const planPath = path.join(planDir, planFilename);

  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');

  return planPath;
}

function isExecutionPlanShape(value: unknown): value is ExecutionPlan {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { goal?: unknown; steps?: unknown };
  return typeof candidate.goal === 'string' && Array.isArray(candidate.steps);
}

/**
 * Loads an execution plan from an absolute path, relative path, or plans directory filename.
 *
 * Accepts two on-disk shapes:
 *   - Bare ExecutionPlan: `{ goal, createdAt, steps, metadata? }` (the format
 *     `savePlanFile` writes under `plans/`).
 *   - Structured-output envelope: `{ goal, planFile, plan: ExecutionPlan }` (the
 *     format `swarm plan --output json` and `swarm plan import --output json`
 *     emit). The envelope is unwrapped to the inner plan.
 *
 * @param planRef - Plan filename or path.
 * @returns Parsed execution plan.
 * @throws Error when the file is missing, not parseable as JSON, or matches
 *   neither the bare nor the envelope shape.
 */
export function loadPlanFile(planRef: string): ExecutionPlan {
  const planPath = resolvePlanPath(planRef);

  if (!fs.existsSync(planPath)) {
    const isBareName =
      !path.isAbsolute(planRef) &&
      !planRef.includes(path.sep) &&
      !planRef.startsWith('./') &&
      !planRef.startsWith('../');
    const hint = isBareName
      ? ` (looked in cwd and ${getPlanDir()}); pass an explicit path like ./${planRef} or plans/${planRef} if the file lives elsewhere`
      : '';
    throw new Error(`Plan file not found: ${planPath}${hint}`);
  }

  const raw = fs.readFileSync(planPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Plan file is not valid JSON: ${planPath}; check the file for syntax errors or stray prose mixed into the JSON output`,
      { cause: err },
    );
  }

  if (isExecutionPlanShape(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === 'object' && 'plan' in parsed) {
    const inner = (parsed as { plan: unknown }).plan;
    if (isExecutionPlanShape(inner)) {
      return inner;
    }
  }

  throw new Error(
    `Plan file at ${planPath} does not match the expected schema; expected either a plan object with "goal" and "steps" fields, or a structured-output envelope with a "plan" field containing the same. Regenerate via \`swarm plan\` or \`swarm bootstrap\`.`,
  );
}