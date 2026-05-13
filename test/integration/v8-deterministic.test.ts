import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleCompile } from '../../src/cli/v8/compile-handler';
import { handleRun } from '../../src/cli/v8/run-handler';
import { StubExtractor } from '../../src/contract/extractor/stub-extractor';

const stubCompile = (): { extractor: StubExtractor } => ({
  extractor: StubExtractor.fromHeuristic(),
});
import { readEntries } from '../../src/ledger/jsonl-ledger';
import { readContract } from '../../src/contract/serializer';
import { StubSession } from '../../src/session/stub-session';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-det-int-'));
}

interface RunResultFile {
  satisfied: number;
  failed: number;
  deterministicObligations: number;
  deterministicReroutes: number;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

describe('integration: v8 deterministic floor (Phase 5)', () => {
  it('compile auto-tags a LICENSE obligation; run satisfies it with zero LLM tokens (§8 exit (a))', async () => {
    const work = tmpDir();
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify(
        { name: 'wf', private: true, scripts: { build: "node -e ''", test: "node -e ''" } },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(work, 'tsconfig.json'), '{}');

    const contractDir = path.join(work, 'contract');
    const compileExit = await handleCompile(
      [
        'add a CHANGELOG.md to the project',
        '--repo-root', work,
        '--out', contractDir,
        '--yes',
        '--no-editor',
      ],
      stubCompile(),
    );
    assert.equal(compileExit, 0);

    // Confirm the compiler auto-tagged the CHANGELOG.md obligation.
    const contract = readContract(contractDir);
    const changelog = contract.obligations.find(
      (o) => o.type === 'file-must-exist' && o.path === 'CHANGELOG.md',
    );
    assert.ok(changelog, 'expected CHANGELOG.md obligation to be present');
    assert.equal(changelog?.deterministicStrategy, 'scaffold-template');

    // Run.  Use a stub session that throws if synthesis is invoked for
    // the deterministic obligation; build/test obligations call into
    // the session normally.
    const ledgerPath = path.join(work, 'ledger.jsonl');
    const resultPath = path.join(work, 'result.json');
    const seenPersonas: string[] = [];
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => {
        seenPersonas.push(req.personaId);
        if (req.personaId === 'architect') {
          throw new Error('architect persona must not be called: deterministic floor handles file-must-exist');
        }
        return 'no-op';
      },
    });

    const exit = await handleRun(
      [
        contractDir,
        '--repo-root', work,
        '--ledger', ledgerPath,
        '--result', resultPath,
        '--run-id', 'det-1',
      ],
      { session },
    );
    assert.equal(exit, 0);

    const result: RunResultFile = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.deterministicObligations, 1);
    assert.equal(result.deterministicReroutes, 0);
    assert.equal(result.satisfied, contract.obligations.length);
    assert.equal(result.failed, 0);

    // The CHANGELOG.md file should be on disk now.
    const changelogBody = fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8');
    assert.ok(changelogBody.startsWith('# Changelog'));

    // Ledger trio for the deterministic obligation.
    const entries = readEntries(ledgerPath);
    const detTypes = entries
      .filter((e) => e.type.startsWith('obligation-deterministic'))
      .map((e) => e.type);
    assert.deepEqual(detTypes, [
      'obligation-deterministic-attempted',
      'obligation-deterministic-applied',
    ]);

    // The architect persona should never have been dispatched.
    assert.ok(!seenPersonas.includes('architect'));
  });

  it('--no-deterministic disables the floor and routes everything to synthesis', async () => {
    const work = tmpDir();
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify(
        { name: 'wf', private: true, scripts: { build: "node -e ''", test: "node -e ''" } },
        null,
        2,
      ),
    );
    const contractDir = path.join(work, 'contract');
    await handleCompile(
      [
        'add a CHANGELOG.md to the project',
        '--repo-root', work,
        '--out', contractDir,
        '--yes',
        '--no-editor',
      ],
      stubCompile(),
    );

    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nlicense body\n```' : 'no-op'),
    });
    const resultPath = path.join(work, 'result.json');
    const exit = await handleRun(
      [
        contractDir,
        '--repo-root', work,
        '--ledger', path.join(work, 'ledger.jsonl'),
        '--result', resultPath,
        '--no-deterministic',
        '--run-id', 'det-2',
      ],
      { session },
    );
    assert.equal(exit, 0);
    const result: RunResultFile = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.deterministicObligations, 0);
    assert.equal(result.deterministicReroutes, 0);
    // Synthesis ran, so input/output tokens are non-zero.
    assert.ok(result.totalUsage.inputTokens + result.totalUsage.cacheReadTokens > 0);
  });

  it('compile records the deterministicStrategy field on disk', async () => {
    const work = tmpDir();
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify(
        { name: 'wf', private: true, scripts: { build: "node -e ''", test: "node -e ''" } },
        null,
        2,
      ),
    );
    const contractDir = path.join(work, 'contract');
    await handleCompile(
      [
        'add a CHANGELOG.md',
        '--repo-root', work,
        '--out', contractDir,
        '--yes',
        '--no-editor',
      ],
      stubCompile(),
    );
    const onDisk = fs.readFileSync(path.join(contractDir, 'contract.jsonl'), 'utf8');
    assert.match(onDisk, /"deterministicStrategy":"scaffold-template"/);
  });
});
