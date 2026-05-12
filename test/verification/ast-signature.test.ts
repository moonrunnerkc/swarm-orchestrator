import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkFunctionSignature } from '../../src/verification/ast-signature';

/**
 * Tests for the AST-backed signature checker. These are regression
 * tests against the v8.0 substring matcher: every case here either
 * tests a TypeScript/JavaScript shape that the substring matcher could
 * not parse (overload, arrow function on an object literal, method
 * inside a class) or a known substring-matcher false positive
 * (signature appearing inside a string literal / comment).
 */

describe('verification/ast-signature', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-sig-'));
  });

  afterEach(() => {
    if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function write(rel: string, body: string): string {
    const abs = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    return abs;
  }

  it('rejects a "function in a string literal" false positive that would fool a substring matcher', () => {
    const abs = write(
      'src/strings.ts',
      `export const hint = "function handler(req: Request): Response { return null; }";\n`,
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'handler', '(req: Request): Response');
    assert.equal(result.matched, false);
    assert.equal(result.nameFound, false);
  });

  it('rejects a "function in a // comment" false positive that would fool a substring matcher', () => {
    const abs = write(
      'src/notes.ts',
      `// handler(req: Request): Response is the legacy shape\nexport const x = 1;\n`,
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'handler', '(req: Request): Response');
    assert.equal(result.matched, false);
    assert.equal(result.nameFound, false);
  });

  it('matches a TypeScript overload declaration', () => {
    const abs = write(
      'src/api.ts',
      [
        'export function api(req: string): string;',
        'export function api(req: number): number;',
        'export function api(req: any): any { return req; }',
        '',
      ].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'api', '(req: number): number');
    assert.equal(result.matched, true, `observed=${JSON.stringify(result.observedNormalized)}`);
  });

  it('matches an arrow function exported as a const', () => {
    const abs = write(
      'src/impl.ts',
      'export const ping = (req: Request): void => { void req; };\n',
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'ping', '(req: Request): void');
    assert.equal(result.matched, true, `observed=${JSON.stringify(result.observedNormalized)}`);
  });

  it('matches an arrow function wrapped in a one-arg call (Express catchAsync pattern)', () => {
    const abs = write(
      'src/controllers/user.controller.js',
      [
        "const catchAsync = require('../utils/catchAsync');",
        '',
        'const getUser = catchAsync(async (req, res) => {',
        '  res.send({});',
        '});',
        '',
        'const changeMyPassword = catchAsync(async (req, res) => {',
        '  // verify and update password',
        '  res.status(204).send();',
        '});',
        '',
        'module.exports = { getUser, changeMyPassword };',
        '',
      ].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'changeMyPassword', '(req, res)');
    assert.equal(
      result.matched,
      true,
      `observed=${JSON.stringify(result.observedNormalized)}`,
    );
  });

  it('matches an arrow function wrapped in asyncHandler (alternate Express wrapper)', () => {
    const abs = write(
      'src/handlers.js',
      'const handler = asyncHandler((req, res) => res.send({}));\n',
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'handler', '(req, res)');
    assert.equal(
      result.matched,
      true,
      `observed=${JSON.stringify(result.observedNormalized)}`,
    );
  });

  it('does not match a const whose initializer is a non-function call', () => {
    const abs = write(
      'src/notfn.js',
      "const x = require('./y');\n",
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'x', '(req, res)');
    assert.equal(result.matched, false);
  });

  it('matches a method declared inside a class', () => {
    const abs = write(
      'src/server.ts',
      ['export class Server {', '  handle(req: Request): Promise<Response> {', '    return Promise.resolve(new Response());', '  }', '}', ''].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'handle', '(req: Request): Promise<Response>');
    assert.equal(result.matched, true, `observed=${JSON.stringify(result.observedNormalized)}`);
  });

  it('reports an actionable mismatch when the function exists with a different shape', () => {
    const abs = write('src/handler.ts', 'export function handler(): void {}\n');
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'handler', '(req: Request): void');
    assert.equal(result.matched, false);
    assert.equal(result.nameFound, true);
    assert.equal(result.observedNormalized[0], '():void');
  });

  it('matches a Python function with annotations via the python3 ast module', function () {
    const abs = write(
      'src/calc.py',
      ['def add(x: int, y: int) -> int:', '    return x + y', ''].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'add', '(x: int, y: int) -> int');
    if (result.error && /python3 not found/.test(result.error)) {
      this.skip();
      return;
    }
    assert.equal(result.matched, true, `observed=${JSON.stringify(result.observedNormalized)}`);
  });

  it('rejects a Python function with a different return annotation', function () {
    const abs = write(
      'src/calc.py',
      ['def add(x: int, y: int) -> float:', '    return float(x + y)', ''].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const result = checkFunctionSignature(abs, body, 'add', '(x: int, y: int) -> int');
    if (result.error && /python3 not found/.test(result.error)) {
      this.skip();
      return;
    }
    assert.equal(result.matched, false);
    assert.equal(result.nameFound, true);
  });
});
