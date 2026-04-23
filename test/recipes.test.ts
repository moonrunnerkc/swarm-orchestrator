import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadRecipe, listRecipes, listRecipeDetails, parameterizeRecipe } from '../src/recipe-loader';
import { handleRecipesCommand, handleRecipeInfoCommand } from '../src/cli/index';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-test-'));
}

const RECIPES_DIR = path.resolve(__dirname, '..', 'templates', 'recipes');
// When running from dist/, resolve up to the repo root
const RECIPES_DIR_SRC = path.resolve(__dirname, '..', '..', 'templates', 'recipes');
const recipesPath = fs.existsSync(RECIPES_DIR) ? RECIPES_DIR : RECIPES_DIR_SRC;

describe('Recipe System', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  // ── listRecipes ────────────────────────────────────────────────

  describe('listRecipes', () => {
    it('returns all 7 built-in recipes', () => {
      const recipes = listRecipes();
      assert.ok(recipes.length >= 7, `Expected at least 7 recipes, got ${recipes.length}`);
    });

    it('returns sorted recipe names', () => {
      const recipes = listRecipes();
      const sorted = [...recipes].sort();
      assert.deepStrictEqual(recipes, sorted);
    });

    it('includes expected recipe names', () => {
      const recipes = listRecipes();
      const expected = [
        'add-api-docs',
        'add-auth',
        'add-ci',
        'add-tests',
        'migrate-to-ts',
        'refactor-modularize',
        'security-audit',
      ];
      for (const name of expected) {
        assert.ok(recipes.includes(name), `Missing recipe: ${name}`);
      }
    });
  });

  // ── loadRecipe ─────────────────────────────────────────────────

  describe('loadRecipe', () => {
    it('loads a valid recipe by name', () => {
      const recipe = loadRecipe('add-tests');
      assert.strictEqual(recipe.name, 'add-tests');
      assert.ok(recipe.description.length > 0);
      assert.ok(recipe.steps.length > 0);
      assert.ok(recipe.parameters !== undefined);
    });

    it('throws with available names for unknown recipe', () => {
      assert.throws(
        () => loadRecipe('nonexistent-recipe'),
        (err: Error) => {
          assert.ok(err.message.includes('Unknown recipe "nonexistent-recipe"'));
          assert.ok(err.message.includes('add-tests'));
          return true;
        }
      );
    });

    it('parses all recipe JSON files without errors', () => {
      const names = listRecipes();
      for (const name of names) {
        const recipe = loadRecipe(name);
        assert.strictEqual(typeof recipe.name, 'string');
        assert.strictEqual(typeof recipe.description, 'string');
        assert.strictEqual(typeof recipe.category, 'string');
        assert.ok(Array.isArray(recipe.steps));
        assert.ok(recipe.steps.length > 0, `Recipe ${name} has no steps`);
      }
    });
  });

  // ── Recipe JSON structure validation ───────────────────────────

  describe('recipe JSON structure', () => {
    const allRecipes = listRecipes();

    it('every recipe has valid step numbers starting at 1', () => {
      for (const name of allRecipes) {
        const recipe = loadRecipe(name);
        const stepNumbers = recipe.steps.map(s => s.stepNumber);
        assert.strictEqual(stepNumbers[0], 1, `${name}: first step should be 1`);
        for (let i = 1; i < stepNumbers.length; i++) {
          assert.strictEqual(
            stepNumbers[i],
            stepNumbers[i - 1]! + 1,
            `${name}: step numbers should be sequential`
          );
        }
      }
    });

    it('every recipe step has an agentName and task', () => {
      for (const name of allRecipes) {
        const recipe = loadRecipe(name);
        for (const step of recipe.steps) {
          assert.ok(step.agentName.length > 0, `${name} step ${step.stepNumber}: missing agentName`);
          assert.ok(step.task.length > 0, `${name} step ${step.stepNumber}: missing task`);
        }
      }
    });

    it('dependencies reference valid earlier steps', () => {
      for (const name of allRecipes) {
        const recipe = loadRecipe(name);
        for (const step of recipe.steps) {
          for (const dep of step.dependencies) {
            assert.ok(
              dep < step.stepNumber && dep >= 1,
              `${name} step ${step.stepNumber}: dependency ${dep} is invalid`
            );
          }
        }
      }
    });

    it('every recipe has a category', () => {
      for (const name of allRecipes) {
        const recipe = loadRecipe(name);
        assert.ok(recipe.category.length > 0, `${name}: missing category`);
      }
    });

    it('parameter definitions have descriptions', () => {
      for (const name of allRecipes) {
        const recipe = loadRecipe(name);
        for (const [key, param] of Object.entries(recipe.parameters)) {
          assert.ok(
            param.description.length > 0,
            `${name}: parameter "${key}" missing description`
          );
        }
      }
    });
  });

  // ── parameterizeRecipe ─────────────────────────────────────────

  describe('parameterizeRecipe', () => {
    it('substitutes user-provided parameter values', () => {
      const recipe = loadRecipe('add-tests');
      const plan = parameterizeRecipe(recipe, { framework: 'jest', 'coverage-target': '90' });
      assert.ok(plan.goal.includes('add-tests'));
      assert.strictEqual(plan.steps.length, recipe.steps.length);
      // "jest" should appear in one of the tasks since it replaces {{framework}}
      const allTasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(allTasks.includes('jest'), 'should substitute framework parameter');
    });

    it('uses defaults when no user value provided', () => {
      const recipe = loadRecipe('add-tests');
      const plan = parameterizeRecipe(recipe, {});
      // add-tests has framework default "mocha"
      const allTasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(allTasks.includes('mocha'), 'should fall back to default framework');
    });

    it('user values override defaults', () => {
      const recipe = loadRecipe('add-tests');
      const plan = parameterizeRecipe(recipe, { framework: 'vitest' });
      const allTasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(allTasks.includes('vitest'), 'user value should override default');
      assert.ok(!allTasks.includes('mocha'), 'default should not appear when overridden');
    });

    it('produces a valid ExecutionPlan', () => {
      const recipe = loadRecipe('add-ci');
      const plan = parameterizeRecipe(recipe, {});
      assert.ok(plan.goal.length > 0);
      assert.ok(plan.createdAt.length > 0);
      assert.ok(plan.steps.length > 0);
      for (const step of plan.steps) {
        assert.strictEqual(typeof step.stepNumber, 'number');
        assert.strictEqual(typeof step.agentName, 'string');
        assert.strictEqual(typeof step.task, 'string');
        assert.ok(Array.isArray(step.dependencies));
        assert.ok(Array.isArray(step.expectedOutputs));
      }
    });

    it('preserves step dependencies and expectedOutputs', () => {
      const recipe = loadRecipe('add-auth');
      const plan = parameterizeRecipe(recipe, {});
      // Step 2 depends on step 1 in the add-auth recipe
      const step2 = plan.steps.find(s => s.stepNumber === 2);
      assert.ok(step2);
      assert.ok(step2.dependencies.includes(1));
      assert.ok(step2.expectedOutputs.length > 0);
    });

    it('does not mutate the original recipe steps', () => {
      const recipe = loadRecipe('add-tests');
      const originalTask = recipe.steps[0]!.task;
      parameterizeRecipe(recipe, { framework: 'jest' });
      assert.strictEqual(recipe.steps[0]!.task, originalTask, 'original recipe should not be mutated');
    });
  });

  // ── listRecipeDetails ──────────────────────────────────────────

  describe('listRecipeDetails', () => {
    it('returns full recipe objects for all recipes', () => {
      const details = listRecipeDetails();
      assert.ok(details.length >= 7);
      for (const recipe of details) {
        assert.ok(recipe.name.length > 0);
        assert.ok(recipe.steps.length > 0);
      }
    });
  });

  // ── CLI handlers ───────────────────────────────────────────────

  describe('handleRecipesCommand', () => {
    it('returns exit code 0', () => {
      const exitCode = handleRecipesCommand();
      assert.strictEqual(exitCode, 0);
    });
  });

  describe('handleRecipeInfoCommand', () => {
    it('returns 0 for a valid recipe', () => {
      const exitCode = handleRecipeInfoCommand(['recipe-info', 'add-tests']);
      assert.strictEqual(exitCode, 0);
    });

    it('returns 1 when no recipe name provided', () => {
      const exitCode = handleRecipeInfoCommand(['recipe-info']);
      assert.strictEqual(exitCode, 1);
    });

    it('returns 1 for an unknown recipe', () => {
      const exitCode = handleRecipeInfoCommand(['recipe-info', 'nonexistent']);
      assert.strictEqual(exitCode, 1);
    });
  });

  // ── Individual recipe smoke tests ──────────────────────────────

  describe('individual recipes', () => {
    it('add-tests recipe parameterizes correctly', () => {
      const recipe = loadRecipe('add-tests');
      assert.strictEqual(recipe.category, 'testing');
      const plan = parameterizeRecipe(recipe, { framework: 'jest', 'coverage-target': '95' });
      const tasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(tasks.includes('jest'));
      assert.ok(tasks.includes('95'));
    });

    it('add-auth recipe parameterizes correctly', () => {
      const recipe = loadRecipe('add-auth');
      assert.strictEqual(recipe.category, 'feature');
      const plan = parameterizeRecipe(recipe, { 'auth-type': 'session', provider: 'github' });
      const tasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(tasks.includes('session'));
      assert.ok(tasks.includes('github'));
    });

    it('add-ci recipe parameterizes correctly', () => {
      const recipe = loadRecipe('add-ci');
      assert.strictEqual(recipe.category, 'devops');
      const plan = parameterizeRecipe(recipe, { 'node-version': '22', 'package-manager': 'pnpm' });
      const tasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(tasks.includes('22'));
      assert.ok(tasks.includes('pnpm'));
    });

    it('migrate-to-ts recipe parameterizes correctly', () => {
      const recipe = loadRecipe('migrate-to-ts');
      assert.strictEqual(recipe.category, 'migration');
      const plan = parameterizeRecipe(recipe, { strictness: 'moderate' });
      const tasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(tasks.includes('moderate'));
    });

    it('add-api-docs recipe parameterizes correctly', () => {
      const recipe = loadRecipe('add-api-docs');
      assert.strictEqual(recipe.category, 'documentation');
      const plan = parameterizeRecipe(recipe, { format: 'markdown' });
      const tasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(tasks.includes('markdown'));
    });

    it('security-audit recipe parameterizes correctly', () => {
      const recipe = loadRecipe('security-audit');
      assert.strictEqual(recipe.category, 'security');
      const plan = parameterizeRecipe(recipe, { severity: 'critical' });
      const tasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(tasks.includes('critical'));
    });

    it('refactor-modularize recipe parameterizes correctly', () => {
      const recipe = loadRecipe('refactor-modularize');
      assert.strictEqual(recipe.category, 'refactoring');
      const plan = parameterizeRecipe(recipe, { target: 'src/main.ts', 'max-lines': '200' });
      const tasks = plan.steps.map(s => s.task).join(' ');
      assert.ok(tasks.includes('src/main.ts'));
      assert.ok(tasks.includes('200'));
    });
  });

  // Knowledge base recordRecipeRun integration
  describe('KnowledgeBaseManager.recordRecipeRun', () => {
    it('records a recipe run as a recipe_run pattern', () => {
      const { KnowledgeBaseManager } = require('../src/knowledge-base');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-kb-'));
      tempDirs.push(dir);
      const kb = new KnowledgeBaseManager(dir);

      kb.recordRecipeRun({
        recipe: 'add-tests',
        parameters: { framework: 'mocha' },
        tool: 'copilot',
        passed: true,
        duration: 5000,
        stepsCompleted: 3,
        totalSteps: 3,
      });

      const patterns = kb.getPatternsByCategory('recipe_run');
      assert.strictEqual(patterns.length, 1);
      assert.ok(patterns[0].insight.includes('add-tests'));
      assert.ok(patterns[0].insight.includes('copilot'));
      assert.ok(patterns[0].insight.includes('passed'));
      assert.ok(patterns[0].evidence.some((e: string) => e === 'recipe:add-tests'));
      assert.ok(patterns[0].evidence.some((e: string) => e === 'tool:copilot'));
    });

    it('records failed recipe runs', () => {
      const { KnowledgeBaseManager } = require('../src/knowledge-base');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-kb-'));
      tempDirs.push(dir);
      const kb = new KnowledgeBaseManager(dir);

      kb.recordRecipeRun({
        recipe: 'security-audit',
        parameters: {},
        tool: 'claude-code',
        passed: false,
        duration: 12000,
        stepsCompleted: 1,
        totalSteps: 3,
      });

      const patterns = kb.getPatternsByCategory('recipe_run');
      assert.strictEqual(patterns.length, 1);
      assert.ok(patterns[0].insight.includes('failed'));
      assert.ok(patterns[0].insight.includes('1/3'));
    });
  });
});
