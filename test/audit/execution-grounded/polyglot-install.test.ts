import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  planGoInstall,
  planPythonInstall,
  provisionNonNode,
} from '../../../src/audit/execution-grounded/polyglot-install';
import { provisionEcosystem } from '../../../src/audit/execution-grounded/sandbox';
import { SwarmError } from '../../../src/errors';

function toolAvailable(cmd: string, args: readonly string[]): boolean {
  try {
    return spawnSync(cmd, args as string[], { encoding: 'utf8', timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
}

const VENV_OK = toolAvailable('python3', ['-m', 'venv', '--help']);
const GO = toolAvailable('go', ['version']);

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(dir: string, file: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), body);
}

function labels(steps: readonly { label: string }[]): string[] {
  return steps.map((s) => s.label);
}

describe('planPythonInstall', () => {
  it('installs a pinned requirements.txt into an isolated venv', () => {
    const dir = tmp('poly-req-');
    try {
      write(dir, 'requirements.txt', 'flask==3.0.0\n');
      const steps = planPythonInstall(dir);
      assert.deepEqual(labels(steps), ['create venv', 'pip install -r requirements.txt']);
      assert.ok(steps[0]!.args.includes('venv'));
      assert.ok(steps[1]!.bin.endsWith(path.join('.venv', 'bin', 'python')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installs the project itself when only a pyproject/setup is present', () => {
    const dir = tmp('poly-proj-');
    try {
      write(dir, 'pyproject.toml', '[project]\nname = "x"\nversion = "0.0.0"\n');
      assert.deepEqual(labels(planPythonInstall(dir)), ['create venv', 'pip install .']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installs both requirements and the project when both exist', () => {
    const dir = tmp('poly-both-');
    try {
      write(dir, 'requirements.txt', '');
      write(dir, 'setup.py', 'from setuptools import setup\nsetup(name="x")\n');
      assert.deepEqual(labels(planPythonInstall(dir)), [
        'create venv',
        'pip install -r requirements.txt',
        'pip install .',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes a poetry project through poetry install, not pip', () => {
    const dir = tmp('poly-poetry-');
    try {
      write(dir, 'pyproject.toml', '[tool.poetry]\nname = "x"\n');
      write(dir, 'poetry.lock', '# lock\n');
      const steps = planPythonInstall(dir);
      assert.deepEqual(labels(steps), ['poetry install']);
      assert.equal(steps[0]!.bin, 'poetry');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('planGoInstall', () => {
  it('downloads the module graph frozen against go.sum', () => {
    const steps = planGoInstall('/anything');
    assert.deepEqual(labels(steps), ['go mod download']);
    assert.deepEqual(steps[0]!.args, ['mod', 'download']);
  });
});

describe('provisionEcosystem', () => {
  it('routes a package.json tree to node', () => {
    const dir = tmp('eco-node-');
    try {
      write(dir, 'package.json', '{"name":"x"}');
      assert.equal(provisionEcosystem(dir), 'node');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes a go.mod tree to go, even alongside python markers', () => {
    const dir = tmp('eco-go-');
    try {
      write(dir, 'go.mod', 'module x\n');
      write(dir, 'requirements.txt', '');
      assert.equal(provisionEcosystem(dir), 'go');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes a python project with a pytest signal to python', () => {
    const dir = tmp('eco-py-');
    try {
      write(dir, 'pyproject.toml', '[project]\nname="x"\n');
      write(dir, 'tests/test_x.py', 'def test_ok():\n    assert True\n');
      assert.equal(provisionEcosystem(dir), 'python');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('provisionNonNode (python)', function () {
  // venv creation is real but offline (ensurepip is bundled); allow time for it.
  this.timeout(120_000);

  (VENV_OK ? it : it.skip)('creates an isolated venv and installs an empty requirements offline', () => {
    const dir = tmp('poly-venv-');
    try {
      write(dir, 'requirements.txt', '# no dependencies\n');
      write(dir, 'tests/test_x.py', 'def test_ok():\n    assert True\n');
      provisionNonNode(dir, 'python', { timeoutMs: 90_000 });
      assert.ok(
        fs.existsSync(path.join(dir, '.venv', 'bin', 'python')),
        'the venv interpreter should exist after a successful python provision',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('provisionNonNode (go)', () => {
  it('runs go mod download when go is present, else fails closed with a recorded error', () => {
    const dir = tmp('poly-go-');
    try {
      write(dir, 'go.mod', 'module example.com/x\n\ngo 1.21\n');
      write(dir, 'x.go', 'package x\n\nfunc Add(a, b int) int { return a + b }\n');
      if (GO) {
        provisionNonNode(dir, 'go', { timeoutMs: 60_000 });
        assert.ok(true, 'go mod download completed on a stdlib-only module');
      } else {
        assert.throws(
          () => provisionNonNode(dir, 'go', { timeoutMs: 60_000 }),
          (err: unknown) =>
            err instanceof SwarmError && err.code === 'sandbox-install-failed',
          'a missing go toolchain must fail closed as sandbox-install-failed, never silently pass',
        );
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
