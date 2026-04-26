import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

describe('Demo Templates Gallery', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const root = fs.existsSync(path.join(projectRoot, 'templates')) ? projectRoot : path.resolve(projectRoot, '..');
  const templatesDir = path.join(root, 'templates');

  it('should have a templates directory', () => {
    assert.ok(fs.existsSync(templatesDir), 'templates/ directory must exist');
  });

  it('should have a README.md', () => {
    const readmePath = path.join(templatesDir, 'README.md');
    assert.ok(fs.existsSync(readmePath), 'templates/README.md must exist');
    const content = fs.readFileSync(readmePath, 'utf8');
    assert.ok(content.includes('rest-api'), 'README should reference rest-api template');
    assert.ok(content.includes('react-app'), 'README should reference react-app template');
  });

  const expectedTemplates = ['rest-api.json', 'react-app.json', 'cli-tool.json', 'fullstack.json', 'library.json'];

  expectedTemplates.forEach(templateFile => {
    describe(templateFile, () => {
      it('should exist', () => {
        const filePath = path.join(templatesDir, templateFile);
        assert.ok(fs.existsSync(filePath), `templates/${templateFile} must exist`);
      });

      it('should be valid JSON with required fields', () => {
        const filePath = path.join(templatesDir, templateFile);
        const content = fs.readFileSync(filePath, 'utf8');
        const plan = JSON.parse(content);

        assert.ok(plan.goal, 'Plan must have a goal');
        assert.ok(plan.createdAt, 'Plan must have createdAt');
        assert.ok(Array.isArray(plan.steps), 'Plan must have steps array');
        assert.ok(plan.steps.length > 0, 'Plan must have at least one step');
        assert.ok(plan.metadata, 'Plan must have metadata');
        assert.strictEqual(plan.metadata.totalSteps, plan.steps.length, 'metadata.totalSteps must match steps length');
      });

      it('should have valid step structure', () => {
        const filePath = path.join(templatesDir, templateFile);
        const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        for (const step of plan.steps) {
          assert.ok(typeof step.stepNumber === 'number', `Step must have stepNumber: ${JSON.stringify(step)}`);
          assert.ok(typeof step.agentName === 'string', `Step must have agentName: ${JSON.stringify(step)}`);
          assert.ok(typeof step.task === 'string', `Step must have task: ${JSON.stringify(step)}`);
          assert.ok(Array.isArray(step.dependencies), `Step must have dependencies array: ${JSON.stringify(step)}`);
          assert.ok(Array.isArray(step.expectedOutputs), `Step must have expectedOutputs array: ${JSON.stringify(step)}`);
        }
      });

      it('should have no circular dependencies', () => {
        const filePath = path.join(templatesDir, templateFile);
        const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Simple cycle detection
        const stepMap = new Map(plan.steps.map((s: any) => [s.stepNumber, s] as [number, any]));
        const visited = new Set<number>();
        const inStack = new Set<number>();

        function hasCycle(num: number): boolean {
          if (inStack.has(num)) return true;
          if (visited.has(num)) return false;
          visited.add(num);
          inStack.add(num);
          const step: any = stepMap.get(num);
          if (step) {
            for (const dep of step.dependencies as number[]) {
              if (hasCycle(dep)) return true;
            }
          }
          inStack.delete(num);
          return false;
        }

        for (const step of plan.steps) {
          assert.ok(!hasCycle(step.stepNumber), `Circular dependency detected involving step ${step.stepNumber}`);
          visited.clear();
          inStack.clear();
        }
      });

      it('should reference only known agents', () => {
        const filePath = path.join(templatesDir, templateFile);
        const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        const knownAgents = new Set(['worker', 'reviewer']);

        for (const step of plan.steps) {
          assert.ok(
            knownAgents.has(step.agentName),
            `Step ${step.stepNumber} references unknown agent: ${step.agentName}`
          );
        }
      });
    });
  });
});
