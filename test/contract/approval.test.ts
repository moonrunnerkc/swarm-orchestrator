import { strict as assert } from 'assert';
import {
  ContractRejectedError,
  runApproval,
  type ApprovalIO,
} from '../../src/contract/approval';
import { canonicalSerialize } from '../../src/contract/canonicalize';
import { type DraftContract, type ObligationV1 } from '../../src/contract/types';

function buildDraft(obligations: ObligationV1[]): DraftContract {
  return {
    schemaVersion: 'v1',
    goal: 'goal',
    repoContext: {
      repoRoot: '/tmp/x',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      language: 'typescript',
    },
    obligations,
    extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
  };
}

class StubIO implements ApprovalIO {
  out: string[] = [];
  private replies: string[];
  private editor?: (initial: string) => string;

  constructor(replies: string[], editor?: (initial: string) => string) {
    this.replies = replies;
    if (editor) this.editor = editor;
  }

  print(line: string): void {
    this.out.push(line);
  }

  prompt(_question: string): Promise<string> {
    const next = this.replies.shift();
    if (next === undefined) {
      return Promise.reject(new Error('no more stub replies'));
    }
    return Promise.resolve(next);
  }

  openEditor(initialContent: string, _filename: string): Promise<string> {
    if (!this.editor) return Promise.reject(new Error('editor not configured in stub'));
    return Promise.resolve(this.editor(initialContent));
  }
}

const sampleObligations: ObligationV1[] = [
  { type: 'file-must-exist', path: 'src/health.ts' },
  { type: 'build-must-pass', command: 'npm run build' },
  { type: 'test-must-pass', command: 'npm test' },
];

describe('contract/approval', () => {
  it('autoApprove returns the draft unchanged without prompting', async () => {
    const io = new StubIO([]);
    const draft = buildDraft(sampleObligations);
    const approved = await runApproval(draft, { autoApprove: true, io });
    assert.equal(approved, draft);
    assert.equal(io.out.length, 0);
  });

  it('approves on "a" reply', async () => {
    const io = new StubIO(['a']);
    const draft = buildDraft(sampleObligations);
    const approved = await runApproval(draft, { io });
    assert.equal(approved.obligations.length, 3);
  });

  it('approves on "approve" reply', async () => {
    const io = new StubIO(['approve']);
    const draft = buildDraft(sampleObligations);
    const approved = await runApproval(draft, { io });
    assert.equal(approved.obligations.length, 3);
  });

  it('rejects with ContractRejectedError on "r" reply', async () => {
    const io = new StubIO(['r']);
    const draft = buildDraft(sampleObligations);
    await assert.rejects(() => runApproval(draft, { io }), ContractRejectedError);
  });

  it('re-prompts on unknown reply', async () => {
    const io = new StubIO(['huh', 'a']);
    const draft = buildDraft(sampleObligations);
    const approved = await runApproval(draft, { io });
    assert.ok(io.out.some((line) => line.includes('unknown choice')));
    assert.equal(approved.obligations.length, 3);
  });

  it('edits successfully and approves', async () => {
    const draft = buildDraft(sampleObligations);
    const before = canonicalSerialize(sampleObligations);
    const after = before + '{"type":"file-must-exist","path":"src/extra.ts"}\n';
    const io = new StubIO(['e', 'a'], () => after);
    const approved = await runApproval(draft, { io });
    assert.equal(approved.obligations.length, 4);
    assert.ok(approved.obligations.some((o) => o.type === 'file-must-exist' && o.path === 'src/extra.ts'));
  });

  it('reports invalid edited contract and re-prompts', async () => {
    const draft = buildDraft(sampleObligations);
    // edit removes the test-must-pass line, leaving an invalid contract
    const editor = (_initial: string) =>
      '{"type":"file-must-exist","path":"src/health.ts"}\n' +
      '{"type":"build-must-pass","command":"npm run build"}\n';
    const io = new StubIO(['e', 'a'], editor);
    const approved = await runApproval(draft, { io });
    assert.ok(io.out.some((line) => line.includes('invalid contract')));
    // original draft is preserved across the failed edit
    assert.equal(approved.obligations.length, 3);
  });

  it('disableEditor causes "e" to be treated as unknown', async () => {
    const draft = buildDraft(sampleObligations);
    const io = new StubIO(['e', 'a']);
    const approved = await runApproval(draft, { io, disableEditor: true });
    assert.ok(io.out.some((line) => line.includes('unknown choice')));
    assert.equal(approved.obligations.length, 3);
  });
});
