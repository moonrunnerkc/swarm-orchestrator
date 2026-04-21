import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan, PlanStep } from './plan-generator';

export interface RecipeParameter {
  description: string;
  default?: string;
  options?: string[];
}

export interface RecipeStep {
  stepNumber: number;
  agentName: string;
  task: string;
  dependencies: number[];
  expectedOutputs: string[];
}

export interface Recipe {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, RecipeParameter>;
  steps: RecipeStep[];
}

const RECIPES_DIR = path.join(__dirname, '..', '..', 'templates', 'recipes');

/**
 * Load a recipe by name from the built-in recipes directory.
 * Throws with available recipe names if the requested recipe is not found.
 */
export function loadRecipe(name: string): Recipe {
  const recipePath = path.join(RECIPES_DIR, `${name}.json`);
  if (!fs.existsSync(recipePath)) {
    const available = listRecipes();
    throw new Error(
      `Unknown recipe "${name}". Available recipes: ${available.join(', ')}`
    );
  }
  const content = fs.readFileSync(recipePath, 'utf8');
  return JSON.parse(content) as Recipe;
}

/**
 * List all available recipe names (without .json extension).
 */
export function listRecipes(): string[] {
  if (!fs.existsSync(RECIPES_DIR)) {
    return [];
  }
  return fs.readdirSync(RECIPES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * Return full metadata for all available recipes.
 */
export function listRecipeDetails(): Recipe[] {
  return listRecipes().map(name => loadRecipe(name));
}

/**
 * Substitute {{param}} placeholders in recipe step tasks with provided values.
 * Missing parameters fall back to the recipe's declared defaults.
 * Throws if a placeholder has no provided value and no default.
 */
export function parameterizeRecipe(
  recipe: Recipe,
  params: Record<string, string>
): ExecutionPlan {
  const merged: Record<string, string> = {};

  // Collect defaults first, then override with user-supplied values
  for (const [key, def] of Object.entries(recipe.parameters)) {
    if (params[key] !== undefined) {
      merged[key] = params[key];
    } else if (def.default !== undefined) {
      merged[key] = def.default;
    }
  }

  // Validate: every placeholder in step tasks must be resolvable
  const placeholderRegex = /\{\{(\w[\w-]*)\}\}/g;
  const steps: PlanStep[] = recipe.steps.map(step => {
    let match: RegExpExecArray | null;
    // Reset lastIndex since we reuse the regex
    placeholderRegex.lastIndex = 0;
    while ((match = placeholderRegex.exec(step.task)) !== null) {
      const paramName = match[1];
      if (merged[paramName] === undefined) {
        throw new Error(
          `Recipe "${recipe.name}" step ${step.stepNumber}: parameter "${paramName}" has no value and no default`
        );
      }
    }

    // Replace all placeholders
    const task = step.task.replace(placeholderRegex, (_full, paramName: string) => {
      return merged[paramName] ?? paramName;
    });

    return {
      stepNumber: step.stepNumber,
      agentName: step.agentName,
      task,
      dependencies: [...step.dependencies],
      expectedOutputs: [...step.expectedOutputs],
    };
  });

  return {
    goal: `Recipe: ${recipe.name} (${recipe.description})`,
    createdAt: new Date().toISOString(),
    steps,
    metadata: {
      totalSteps: steps.length,
    },
  };
}
