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

/**
 * Loads an execution plan from an absolute path, relative path, or plans directory filename.
 *
 * @param planRef - Plan filename or path.
 * @returns Parsed execution plan.
 * @throws Error when the plan file does not exist or cannot be parsed as JSON.
 */
export function loadPlanFile(planRef: string): ExecutionPlan {
  const planPath = resolvePlanPath(planRef);

  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  return JSON.parse(fs.readFileSync(planPath, 'utf8')) as ExecutionPlan;
}