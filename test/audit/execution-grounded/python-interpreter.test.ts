import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverInterpreters,
  readDeclaredPythonRange,
  resolvePythonInterpreter,
  satisfiesRange,
} from '../../../src/audit/execution-grounded/python-interpreter';

function projectDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-py-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

describe('execution-grounded python interpreter resolution', () => {
  describe('range satisfaction', () => {
    it('honors the bounded range that canvas-hyperscribe declares', () => {
      // The exact range whose violation made the repo look unprovisionable:
      // "requires a different Python: 3.14.4 not in '<3.13,>=3.11'".
      const spec = '<3.13,>=3.11';
      assert.equal(satisfiesRange('3.11.9', spec), true);
      assert.equal(satisfiesRange('3.12.4', spec), true);
      assert.equal(satisfiesRange('3.13.0', spec), false);
      assert.equal(satisfiesRange('3.14.4', spec), false);
      assert.equal(satisfiesRange('3.10.14', spec), false);
    });

    it('honors an open lower bound', () => {
      assert.equal(satisfiesRange('3.14.4', '>=3.9'), true);
      assert.equal(satisfiesRange('3.8.10', '>=3.9'), false);
    });

    it('expands the poetry caret and tilde shorthands', () => {
      assert.equal(satisfiesRange('3.11.2', '^3.11'), true);
      assert.equal(satisfiesRange('3.12.0', '^3.11'), true);
      assert.equal(satisfiesRange('4.0.0', '^3.11'), false);
      assert.equal(satisfiesRange('3.11.7', '~3.11'), true);
      assert.equal(satisfiesRange('3.12.0', '~3.11'), false);
    });

    it('implements the compatible-release operator', () => {
      assert.equal(satisfiesRange('3.11.5', '~=3.11.0'), true);
      assert.equal(satisfiesRange('3.12.0', '~=3.11.0'), false);
    });

    it('treats an unparseable declaration as no constraint rather than as exclusion', () => {
      assert.equal(satisfiesRange('3.12.0', 'whatever'), true);
    });
  });

  describe('declaration reading', () => {
    it('reads a PEP 621 requires-python', () => {
      const dir = projectDir({
        'pyproject.toml': '[project]\nname = "x"\nrequires-python = ">=3.11,<3.13"\n',
      });
      assert.equal(readDeclaredPythonRange(dir), '>=3.11,<3.13');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('falls back to the poetry python constraint', () => {
      const dir = projectDir({
        'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.11"\n',
      });
      assert.equal(readDeclaredPythonRange(dir), '^3.11');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('falls back to setup.cfg python_requires', () => {
      const dir = projectDir({ 'setup.cfg': '[options]\npython_requires = >=3.10\n' });
      assert.equal(readDeclaredPythonRange(dir), '>=3.10');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('returns null when the project declares nothing', () => {
      const dir = projectDir({ 'requirements.txt': 'requests\n' });
      assert.equal(readDeclaredPythonRange(dir), null);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('interpreter selection', () => {
    it('finds at least one interpreter in an environment that has python3', function () {
      const found = discoverInterpreters(process.env);
      if (found.length === 0) return this.skip();
      assert.ok(found.every((i) => /^\d+\.\d+/.test(i.version)));
    });

    it('picks an in-range interpreter when the declared range excludes the newest', function () {
      const available = discoverInterpreters(process.env);
      const spec = '>=3.11,<3.13';
      if (!available.some((i) => satisfiesRange(i.version, spec))) return this.skip();
      const dir = projectDir({
        'pyproject.toml': `[project]\nname = "x"\nrequires-python = "${spec}"\n`,
      });
      const res = resolvePythonInterpreter(dir, process.env);
      assert.ok(res.ok);
      assert.equal(res.interpreter.declaredRange, spec);
      assert.equal(satisfiesRange(res.interpreter.version, spec), true);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('fails with the declared range and what was available when nothing satisfies it', () => {
      const dir = projectDir({
        'pyproject.toml': '[project]\nname = "x"\nrequires-python = ">=99.0"\n',
      });
      const res = resolvePythonInterpreter(dir, process.env);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.failure.declaredRange, '>=99.0');
        assert.match(res.failure.detail, /no installed interpreter satisfies it/);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('names the missing toolchain when no interpreter exists at all', () => {
      const dir = projectDir({ 'requirements.txt': 'requests\n' });
      const res = resolvePythonInterpreter(dir, { PATH: '/nonexistent-bin-dir' });
      assert.equal(res.ok, false);
      if (!res.ok) assert.match(res.failure.detail, /no python3 interpreter is resolvable/);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
