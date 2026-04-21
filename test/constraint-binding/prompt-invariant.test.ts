import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS = path.join(REPO_ROOT, 'benchmarks', 'harness', 'run_fresh.sh');
const TASKS_DIR = path.join(REPO_ROOT, 'benchmarks', 'constraint-binding', 'tasks');
const ENGINE = path.join(REPO_ROOT, 'benchmarks', 'constraint-binding', 'validator-engine.js');

const engine: { loadTask: (p: string) => Record<string, unknown> } = require(ENGINE);

/**
 * The fair-test invariant: the `prompt` field from each task YAML is passed
 * byte-for-byte into the CLI invocation of every producer (ORCHESTRATOR,
 * SINGLE_SHOT, LADDER). The harness script is the single binding point; the
 * producers receive the string as a positional/flag argument and may
 * decompose it internally but must not mutate the string itself before the
 * first agent boundary.
 *
 * These tests exercise the harness source directly — no network, no agent
 * spawn — to confirm the binding path preserves bytes exactly.
 */
describe('Byte-identical prompt invariant', () => {
  it('harness passes $task_prompt unchanged to each producer', () => {
    const src = fs.readFileSync(HARNESS, 'utf8');

    // ORCHESTRATOR: `node "$SWARM_BIN" run --goal "$task_prompt"`
    assert.match(
      src,
      /node "\$SWARM_BIN" run\s*\\\s*\n\s*--goal "\$task_prompt"/,
      'ORCHESTRATOR invocation must pass --goal "$task_prompt" verbatim',
    );

    // SINGLE_SHOT: `claude --dangerously-skip-permissions -p "$task_prompt"`
    assert.match(
      src,
      /claude[^\n]*-p "\$task_prompt"/,
      'SINGLE_SHOT invocation must pass -p "$task_prompt" verbatim',
    );

    // LADDER: within the inline fallback, each `$prompt` is passed -p "$prompt"
    assert.match(
      src,
      /claude[^\n]*-p "\$prompt"/,
      'LADDER invocation must pass -p "$prompt" verbatim per ladder step',
    );

    // And the variable is assigned from the task source without mutation.
    assert.match(
      src,
      /task_prompt=\$\(cb_field "\$task_yaml" prompt\)/,
      'CONSTRAINT_BINDING task_prompt must come straight from cb_field with no transform',
    );
  });

  it('cb_field pulls prompt bytes out of YAML without loss', () => {
    // Build a prompt with characters that commonly break shell plumbing:
    // newlines, single quotes, double quotes, backslashes, $var-lookalikes,
    // and unicode. If the YAML parser or our extractor mangles any of these,
    // the assertion fails.
    const tricky = [
      'Line one with $VAR and ${VAR}',
      'Line two with "double" and \'single\' quotes',
      'Line three with a backslash \\ and a tab:\there',
      'Line four with unicode: λ ∑ 🔥',
    ].join('\n');

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-prompt-'));
    try {
      const yamlPath = path.join(scratch, 'probe.yaml');
      // Emit the YAML using a literal block scalar so the newlines land intact.
      const yamlText =
        'id: probe\n' +
        'name: probe\n' +
        'pattern: rename-then-update-callers\n' +
        'pre_state:\n' +
        '  fixture_tarball: probe.tar.gz\n' +
        '  source_repo: https://example.com/r\n' +
        '  source_sha: ' + 'a'.repeat(40) + '\n' +
        '  fixture_sha256: pending\n' +
        'prompt: |\n' +
        tricky
          .split('\n')
          .map((l) => '  ' + l)
          .join('\n') +
        '\n' +
        'expected_steps_min: 1\n' +
        'post_state_validators:\n' +
        '  - name: x\n' +
        '    cmd: "true"\n';
      fs.writeFileSync(yamlPath, yamlText);

      // (a) JS loader round-trips the prompt
      const task = engine.loadTask(yamlPath) as { prompt: string };
      assert.strictEqual(task.prompt.trimEnd(), tricky);

      // (b) The bash path used by the harness (`cb_field` via `node -e`) emits
      // the same bytes to stdout. Re-implement the exact cb_field pipeline so
      // the test covers the binding the harness uses.
      const out = execFileSync(
        'node',
        [
          '-e',
          `
          const y = require('js-yaml');
          const fs = require('fs');
          const t = y.load(fs.readFileSync(process.argv[1],'utf8'));
          process.stdout.write(t.prompt);
          `,
          yamlPath,
        ],
        { encoding: 'utf8' },
      );
      assert.strictEqual(out.trimEnd(), tricky);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('every shipped task has a non-empty prompt', () => {
    const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith('.yaml'));
    assert.ok(files.length > 0, 'no task YAMLs found');
    for (const f of files) {
      const task = engine.loadTask(path.join(TASKS_DIR, f)) as { prompt: string };
      assert.ok(
        typeof task.prompt === 'string' && task.prompt.trim().length > 20,
        `${f}: prompt too short (< 20 chars after trim)`,
      );
    }
  });
});
