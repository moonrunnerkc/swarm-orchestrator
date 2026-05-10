import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { canonicalSerialize, canonicalSort } from './canonicalize';
import { parseJsonl } from './serializer';
import { type DraftContract, type ObligationV1 } from './types';
import { validateObligations } from './validator';

/** Thrown when the user explicitly rejects a contract. */
export class ContractRejectedError extends Error {
  constructor() {
    super('contract rejected by user');
    this.name = 'ContractRejectedError';
  }
}

/**
 * IO seam for the approval loop. The default implementation uses readline,
 * stdout, and `$EDITOR`; tests inject a stub.
 */
export interface ApprovalIO {
  /** Print a line to the user. */
  print(line: string): void;
  /** Ask the user a question; return the trimmed reply. */
  prompt(question: string): Promise<string>;
  /** Open the user's editor on the given content; return the post-edit content. */
  openEditor(initialContent: string, filename: string): Promise<string>;
}

export interface RunApprovalOptions {
  /** Skip the prompt and approve immediately. */
  autoApprove?: boolean;
  /** Disable the [e]dit option (e.g. non-interactive runs). */
  disableEditor?: boolean;
  /** IO seam (test injection). */
  io?: ApprovalIO;
}

/**
 * Run the user-approval loop on a draft contract.
 *
 * Returns the (possibly edited) draft when the user approves; throws
 * ContractRejectedError when the user rejects. Edits that produce an
 * invalid contract are reported and the loop re-prompts; the original
 * draft is preserved across failed edits.
 */
export async function runApproval(
  draft: DraftContract,
  options: RunApprovalOptions = {},
): Promise<DraftContract> {
  if (options.autoApprove) return draft;
  const io = options.io ?? defaultApprovalIO();
  let current = draft;
  for (;;) {
    renderDraft(current, io);
    const choiceText = options.disableEditor
      ? '[a]pprove / [r]eject'
      : '[a]pprove / [e]dit / [r]eject';
    const answer = (await io.prompt(`${choiceText}: `)).trim().toLowerCase();
    if (answer === 'a' || answer === 'approve') return current;
    if (answer === 'r' || answer === 'reject') throw new ContractRejectedError();
    if (!options.disableEditor && (answer === 'e' || answer === 'edit')) {
      const next = await editAndValidate(current, io);
      if (next) current = next;
      continue;
    }
    io.print(`unknown choice "${answer}"; please answer "a", "e", or "r".`);
  }
}

async function editAndValidate(
  draft: DraftContract,
  io: ApprovalIO,
): Promise<DraftContract | null> {
  const before = canonicalSerialize(draft.obligations);
  const after = await io.openEditor(before, 'contract.jsonl');
  if (after === before) {
    io.print('no changes; returning to prompt.');
    return null;
  }
  let parsed: unknown[];
  try {
    parsed = parseJsonl(after);
  } catch (err) {
    io.print(`edit produced invalid JSONL: ${(err as Error).message}`);
    return null;
  }
  const requireBuild = draft.repoContext.buildCommand !== null;
  const validation = validateObligations(parsed, { requireBuild });
  if (!validation.valid) {
    io.print('edit produced an invalid contract:');
    for (const e of validation.errors) io.print(`  [${e.code}] ${e.message}`);
    return null;
  }
  return {
    ...draft,
    obligations: canonicalSort(parsed as ObligationV1[]),
  };
}

function renderDraft(draft: DraftContract, io: ApprovalIO): void {
  io.print('');
  io.print(`Goal: ${draft.goal}`);
  const lang = draft.repoContext.language;
  io.print(`Repository: ${draft.repoContext.repoRoot} (language: ${lang})`);
  const ext = draft.extractor;
  const extLabel = ext.model ? `${ext.name} (${ext.model})` : ext.name;
  io.print(`Extractor: ${extLabel}`);
  io.print('Obligations:');
  for (let i = 0; i < draft.obligations.length; i += 1) {
    const obligation = draft.obligations[i];
    if (obligation === undefined) continue;
    io.print(`  ${i + 1}. ${formatObligation(obligation)}`);
  }
  io.print('');
}

function formatObligation(o: ObligationV1): string {
  switch (o.type) {
    case 'file-must-exist':
      return `file-must-exist: ${o.path}`;
    case 'build-must-pass':
    case 'test-must-pass':
      return `${o.type}: ${o.command}`;
    case 'function-must-have-signature':
      return `function-must-have-signature: ${o.file}::${o.name}${o.signature}`;
    case 'property-must-hold':
      return `property-must-hold: ${o.target} via "${o.predicate}"`;
    case 'import-graph-must-satisfy':
      return `import-graph-must-satisfy: ${o.scope} (${o.constraint})`;
    case 'coverage-must-exceed':
      return `coverage-must-exceed: ${o.scope} ${o.metric} >= ${o.threshold}%`;
    case 'performance-must-not-regress':
      return `performance-must-not-regress: "${o.benchmark}" vs ${o.baseline} (≤${(o.threshold * 100).toFixed(1)}%)`;
  }
}

function defaultApprovalIO(): ApprovalIO {
  return {
    print(line) {
      process.stdout.write(line + '\n');
    },
    prompt(question) {
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    },
    openEditor(initialContent, filename) {
      return new Promise<string>((resolve, reject) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-v8-edit-'));
        const tmpPath = path.join(tmpDir, filename);
        fs.writeFileSync(tmpPath, initialContent, 'utf8');
        const editor =
          process.env.EDITOR ?? (process.platform === 'win32' ? 'notepad' : 'vi');
        const child = child_process.spawn(editor, [tmpPath], { stdio: 'inherit' });
        child.on('error', (err) => {
          reject(new Error(`failed to spawn editor "${editor}": ${err.message}`, { cause: err }));
        });
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`editor "${editor}" exited with code ${code}`));
            return;
          }
          try {
            const content = fs.readFileSync(tmpPath, 'utf8');
            resolve(content);
          } catch (err) {
            reject(
              new Error(`failed to read post-edit content: ${(err as Error).message}`, {
                cause: err,
              }),
            );
          }
        });
      });
    },
  };
}
