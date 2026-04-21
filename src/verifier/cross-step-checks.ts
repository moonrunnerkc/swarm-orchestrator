import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { VerificationCheck } from '../verifier-engine';

const MIN_FILE_SIZE_BYTES = 100;

export interface CrossStepContractOpts {
  workdir: string;
  /**
   * Each entry is either a file path relative to `workdir` (e.g. `src/auth.ts`)
   * or a symbol reference of the form `relative/path.ts:exportName`.
   * The former requires existence + size > MIN_FILE_SIZE_BYTES.
   * The latter additionally requires the TypeScript compiler to resolve the
   * named export to a non-undefined initializer.
   */
  requiredInputs: string[];
}

/**
 * Verify that every declared input of a pending step exists as a real artifact
 * produced by an upstream step. An input is considered satisfied when:
 *   - file refs (no `:` suffix): the file exists and is larger than
 *     {@link MIN_FILE_SIZE_BYTES} bytes
 *   - symbol refs (`file:name`): the file parses as TypeScript AND declares an
 *     export named `name` whose initializer is not literal `undefined`
 *
 * Returns a single VerificationCheck summarising the contract.
 *
 * @throws never; captures internal errors as failed checks with `cause` context
 */
export function checkCrossStepContract(opts: CrossStepContractOpts): VerificationCheck {
  if (opts.requiredInputs.length === 0) {
    return {
      type: 'cross_step_contract',
      description: 'Cross-step inputs satisfied',
      required: true,
      passed: true,
      evidence: 'No inputs declared; nothing to validate',
    };
  }

  const missing: string[] = [];
  const satisfied: string[] = [];

  for (const ref of opts.requiredInputs) {
    const result = resolveInput(opts.workdir, ref);
    if (result.ok) {
      satisfied.push(ref);
    } else {
      missing.push(`${ref} (${result.reason})`);
    }
  }

  if (missing.length > 0) {
    return {
      type: 'cross_step_contract',
      description: 'Cross-step inputs satisfied',
      required: true,
      passed: false,
      reason: `Unsatisfied inputs: ${missing.join('; ')}`,
      evidence: `${satisfied.length}/${opts.requiredInputs.length} inputs present`,
    };
  }

  return {
    type: 'cross_step_contract',
    description: 'Cross-step inputs satisfied',
    required: true,
    passed: true,
    evidence: `All ${satisfied.length} declared input(s) verified`,
  };
}

interface ResolveResult {
  ok: boolean;
  reason: string;
}

function resolveInput(workdir: string, ref: string): ResolveResult {
  const isSymbolRef = ref.includes(':');
  const [relativePath, symbolName] = isSymbolRef ? ref.split(':', 2) : [ref, undefined];
  const fullPath = path.join(workdir, relativePath);

  if (!fs.existsSync(fullPath)) {
    return { ok: false, reason: 'file not found' };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch (err: unknown) {
    return { ok: false, reason: `stat failed: ${asMessage(err)}` };
  }

  if (!stat.isFile()) {
    return { ok: false, reason: 'path is not a regular file' };
  }

  if (stat.size <= MIN_FILE_SIZE_BYTES) {
    return { ok: false, reason: `file size ${stat.size}B ≤ ${MIN_FILE_SIZE_BYTES}B threshold` };
  }

  if (!isSymbolRef) {
    return { ok: true, reason: 'file present and non-trivial' };
  }

  return resolveSymbol(fullPath, symbolName!);
}

function resolveSymbol(filePath: string, symbolName: string): ResolveResult {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    return { ok: false, reason: `read failed: ${asMessage(err)}` };
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );

  const found = findExportedSymbol(sourceFile, symbolName);
  if (!found) {
    return { ok: false, reason: `no export named "${symbolName}"` };
  }

  if (found.isUndefinedInitializer) {
    return { ok: false, reason: `export "${symbolName}" is literal undefined` };
  }

  return { ok: true, reason: `export "${symbolName}" resolved` };
}

interface SymbolResolution {
  isUndefinedInitializer: boolean;
}

function findExportedSymbol(source: ts.SourceFile, name: string): SymbolResolution | null {
  let found: SymbolResolution | null = null;

  ts.forEachChild(source, (node) => {
    if (found) return;
    const hit = matchNode(node, name);
    if (hit) found = hit;
  });

  return found;
}

function matchNode(node: ts.Node, name: string): SymbolResolution | null {
  if (ts.isFunctionDeclaration(node) && hasExportModifier(node) && node.name?.text === name) {
    return { isUndefinedInitializer: false };
  }

  if (ts.isClassDeclaration(node) && hasExportModifier(node) && node.name?.text === name) {
    return { isUndefinedInitializer: false };
  }

  if (ts.isInterfaceDeclaration(node) && hasExportModifier(node) && node.name.text === name) {
    return { isUndefinedInitializer: false };
  }

  if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node) && node.name.text === name) {
    return { isUndefinedInitializer: false };
  }

  if (ts.isVariableStatement(node) && hasExportModifier(node)) {
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      const init = decl.initializer;
      const isUndef = !init || (ts.isIdentifier(init) && init.text === 'undefined');
      return { isUndefinedInitializer: isUndef };
    }
  }

  if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const el of node.exportClause.elements) {
      if (el.name.text === name) {
        return { isUndefinedInitializer: false };
      }
    }
  }

  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    if (ts.isIdentifier(node.expression) && node.expression.text === name) {
      return { isUndefinedInitializer: false };
    }
  }

  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
