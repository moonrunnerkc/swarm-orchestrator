import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Regression tests for the v8-e2e Phase D defects (D1, D2, D3, D5).
 *
 * - D1: `swarm run` is the documented post-Phase-4 entry point but currently
 *   dispatches to the v6 handler instead of v8. The impl guide §12 promised
 *   "default switches to v8, `--v6` flag preserves old behavior".
 * - D2: `swarm v8 compile --recipe <name>` is documented in impl guide §12
 *   but the CLI rejects --recipe as an unknown flag.
 * - D3: action.yml is documented to accept `contract-only` and `cost-cap`
 *   inputs but they are missing from the action surface.
 * - D5: src/population/manager.ts:75 comment says "the v8 CLI defaults to
 *   `tournament` post-Phase 3" but run-handler.ts:286 defaults to single.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'dist', 'src', 'cli.js');

describe('v8-e2e Phase D defects', () => {
  // ── D3: action.yml inputs ─────────────────────────────────
  describe('D3 — action.yml ships impl-guide-promised inputs', () => {
    const actionYml = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8');

    it('declares contract-only input', () => {
      assert.match(
        actionYml,
        /^\s+contract-only:/m,
        'action.yml must declare contract-only input (impl guide §12 line 290)',
      );
    });

    it('declares cost-cap input', () => {
      assert.match(
        actionYml,
        /^\s+cost-cap:/m,
        'action.yml must declare cost-cap input (impl guide §12 line 290)',
      );
    });

    it('entrypoint.sh wires contract-only to swarm v8 compile', () => {
      const ep = fs.readFileSync(path.join(ROOT, 'entrypoint.sh'), 'utf8');
      assert.match(
        ep,
        /INPUT_CONTRACT_ONLY/,
        'entrypoint.sh must read INPUT_CONTRACT_ONLY',
      );
      assert.match(
        ep,
        /v8.*compile/,
        'entrypoint.sh must dispatch to swarm v8 compile when contract-only is true',
      );
    });

    it('entrypoint.sh wires cost-cap as --cost-cap flag', () => {
      const ep = fs.readFileSync(path.join(ROOT, 'entrypoint.sh'), 'utf8');
      assert.match(ep, /INPUT_COST_CAP/, 'entrypoint.sh must read INPUT_COST_CAP');
      assert.match(
        ep,
        /--cost-cap/,
        'entrypoint.sh must forward INPUT_COST_CAP as --cost-cap',
      );
    });
  });

  // ── D2: --recipe flag in v8 compile ────────────────────────
  describe('D2 — swarm v8 compile --recipe loads contract templates', () => {
    const RECIPES = [
      'add-tests',
      'add-auth',
      'add-ci',
      'migrate-to-ts',
      'add-api-docs',
      'security-audit',
      'refactor-modularize',
    ];

    it('recognizes --recipe as a flag (no "unknown flag" error)', () => {
      // Sanity: --recipe should NOT be an unknown flag.
      let stderr = '';
      try {
        execSync(`node "${CLI}" v8 compile --recipe add-tests --extractor stub-heuristic --yes --no-editor --out /tmp/v8-recipe-cli-test`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        stderr = (e as { stderr?: string }).stderr ?? '';
      }
      assert.doesNotMatch(
        stderr,
        /unknown flag: --recipe/,
        '--recipe must be a wired flag in the v8 compile CLI',
      );
    });

    it('every shipped recipe yields a v1-schema-valid contract', function () {
      this.timeout(30000);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-recipe-test-'));
      try {
        for (const recipe of RECIPES) {
          const outDir = path.join(tmp, recipe);
          execSync(
            `node "${CLI}" v8 compile --recipe ${recipe} --extractor stub-heuristic --yes --no-editor --out "${outDir}" --repo-root "${tmp}"`,
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          );
          const manifestPath = path.join(outDir, 'manifest.json');
          const contractPath = path.join(outDir, 'contract.jsonl');
          assert.ok(fs.existsSync(manifestPath), `manifest missing for recipe ${recipe}`);
          assert.ok(fs.existsSync(contractPath), `contract.jsonl missing for recipe ${recipe}`);
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          assert.strictEqual(manifest.schemaVersion, 'v1', `recipe ${recipe}: schema must be v1`);
          assert.ok(manifest.contractHash, `recipe ${recipe}: contractHash must be present`);
          assert.ok(manifest.contractId, `recipe ${recipe}: contractId must be present`);
          const obligations = fs
            .readFileSync(contractPath, 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l));
          assert.ok(
            obligations.length > 0,
            `recipe ${recipe}: must yield at least one obligation`,
          );
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  // ── D1: v8 is the default execution path ──────────────────
  describe('D1 — `swarm run` defaults to v8 with --v6 opt-out', () => {
    it('parses --v6 as a known flag for swarm run', () => {
      // --v6 must NOT be rejected as an unknown flag at the top-level dispatch.
      // The dispatch reads --v6 and routes to the legacy handler.
      // We assert by inspecting cli.ts (the dispatch point).
      const cliSrc = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
      assert.match(
        cliSrc,
        /--v6/,
        'src/cli.ts must reference the --v6 flag (impl guide §12 line 275)',
      );
    });

    it('default swarm-run dispatch routes to v8 (not the v6 handler) when no --v6 flag is set', () => {
      const cliSrc = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
      // The top-level case 'run' branch must consult --v6 before calling
      // handleRunCommand. The simplest contract: the run case must reference
      // handleV8Command or a v8 dispatch wrapper.
      const runCase =
        cliSrc.match(/case 'run':[\s\S]*?break;/)?.[0] ?? '';
      assert.ok(runCase.length > 0, 'src/cli.ts must contain a case for run');
      assert.match(
        runCase,
        /v6|V6|handleV8/,
        'the run case must branch on --v6 or call handleV8Command for the v8 path',
      );
    });
  });

  // ── D5: doc-vs-code drift on default mode ─────────────────
  describe('D5 — population manager doc agrees with run-handler default mode', () => {
    it('manager.ts docstring matches run-handler.ts default mode', () => {
      const managerSrc = fs.readFileSync(
        path.join(ROOT, 'src', 'population', 'manager.ts'),
        'utf8',
      );
      const runHandlerSrc = fs.readFileSync(
        path.join(ROOT, 'src', 'cli', 'v8', 'run-handler.ts'),
        'utf8',
      );
      // run-handler default mode: parse the parseRunFlags initializer.
      const runDefault =
        runHandlerSrc.match(/mode:\s*'(single|tournament)'/)?.[1] ?? '';
      assert.ok(runDefault, 'run-handler.ts must set a default mode');
      // manager.ts docstring claim: extract from the comment on `mode?: PopulationMode`.
      const managerClaim =
        managerSrc.match(/the v8 CLI defaults to `(single|tournament)`/)?.[1] ??
        '';
      assert.strictEqual(
        managerClaim,
        runDefault,
        `manager.ts comment claims '${managerClaim}' default but run-handler.ts uses '${runDefault}'`,
      );
    });
  });
});
