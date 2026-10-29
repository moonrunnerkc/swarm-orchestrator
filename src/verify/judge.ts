import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Startup code every Node and Python process of a held-out check loads before the project's
 * own modules (NODE_OPTIONS --import and a PYTHONPATH sitecustomize). It records the assertion
 * machinery as it was and, at exit, appends to a report outside the checkout whether the code
 * under test changed any of it. It is a tripwire for patched assertions, not a sandbox: code
 * that attacks the judge itself is out of its reach.
 */
// Appends to every ES module under a test directory of the checkout a call that hands the
// judge its namespace, so a test helper's methods are recorded once it has evaluated.
const nodeHooks = String.raw`let root = "";
const testPath = /(?:^|\/)(?:test|tests|__tests__|spec|specs|testing)\/|\.(?:test|spec)\.[cm]?js$/;
export function initialize(data) {
  root = data.root;
}
export async function load(url, context, next) {
  const loaded = await next(url, context);
  const inside = url.startsWith(root) && !url.includes("/node_modules/");
  if (loaded.format !== "module" || !inside || !testPath.test(url.slice(root.length))) return loaded;
  const text = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
  const self = JSON.stringify(url);
  const label = JSON.stringify(url.slice(root.length));
  const tail = "\nimport * as __swarmJudgeSelf from " + self + ";\nglobalThis[Symbol.for(\"swarm-verify.judge\")](" + label + ", __swarmJudgeSelf);\n";
  return { ...loaded, source: text + tail };
}
`;

const nodeJudge = String.raw`import { createHash, randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createRequire, register, syncBuiltinESMExports } from "node:module";

const report = process.env.SWARM_JUDGE_REPORT;
if (report) {
  const require = createRequire(import.meta.url);
  const describe = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const keysOf = Reflect.ownKeys;
  const apply = Reflect.apply;
  const source = Function.prototype.toString;
  const nonce = randomBytes(16).toString("hex");
  const watched = [];
  const changed = [];
  let calls = 0;
  const record = (label, holder, key) => {
    const found = describe(holder, key);
    if (found !== undefined) watched[watched.length] = [label + "." + String(key), holder, key, found];
  };
  // An assertion function becomes an accessor that counts calls; assigning it is recorded.
  const trap = (label, holder) => {
    for (const key of keysOf(holder)) {
      const found = describe(holder, key);
      const value = found.value;
      const plain =
        typeof value === "function" &&
        found.configurable &&
        !/^class\b/.test(apply(source, value, [])) &&
        keysOf(value).every((name) => name === "length" || name === "name" || name === "prototype");
      if (plain) {
        const counted = function (...args) {
          calls += 1;
          return apply(value, this, args);
        };
        const name = label + "." + String(key);
        define(holder, key, {
          configurable: true,
          enumerable: found.enumerable,
          get: () => counted,
          set: () => {
            changed[changed.length] = name;
          },
        });
      }
      record(label, holder, key);
    }
  };
  const assert = require("node:assert");
  trap("assert", assert);
  trap("assert.strict", assert.strict);
  syncBuiltinESMExports();
  const test = require("node:test");
  for (const key of keysOf(test)) record("test", test, key);
  const builtins = [
    ["globalThis", globalThis, ["Object", "Array", "String", "Number", "JSON", "Map", "Set"]],
    ["Object", Object, ["is", "keys", "values", "entries", "getPrototypeOf"]],
    ["Array.prototype", Array.prototype, ["includes", "indexOf", "every", "some", "join", "map", "filter", "find", "sort"]],
    ["String.prototype", String.prototype, ["includes", "startsWith", "endsWith", "indexOf", "trim", "toLowerCase", "toUpperCase", "replace", "split"]],
    ["JSON", JSON, ["stringify"]],
    ["Number", Number, ["isNaN"]],
    ["Map.prototype", Map.prototype, ["has", "get"]],
    ["Set.prototype", Set.prototype, ["has"]],
    ["RegExp.prototype", RegExp.prototype, ["test"]],
    ["Function.prototype", Function.prototype, ["call", "apply"]],
  ];
  for (const [label, holder, keys] of builtins) for (const key of keys) record(label, holder, key);
  // A test helper's exported functions, their prototypes' methods and exported objects' methods.
  const helper = (url, namespace) => {
    for (const key of keysOf(namespace)) {
      const value = namespace[key];
      const holders = typeof value === "function" ? [value, value.prototype] : [value];
      for (const holder of holders) {
        if (holder === null || (typeof holder !== "object" && typeof holder !== "function")) continue;
        for (const name of keysOf(holder))
          if (typeof describe(holder, name)?.value === "function") record(url + "#" + String(key), holder, name);
      }
    }
  };
  define(globalThis, Symbol.for("swarm-verify.judge"), { value: helper });
  const root = process.env.SWARM_JUDGE_ROOT;
  if (root) register(process.env.SWARM_JUDGE_HOOKS, import.meta.url, { data: { root } });
  appendFileSync(report, "start " + createHash("sha256").update(nonce).digest("hex") + "\n");
  process.on("exit", () => {
    for (const [name, holder, key, found] of watched) {
      const now = describe(holder, key);
      if (now === undefined || now.value !== found.value || now.get !== found.get || now.set !== found.set)
        changed[changed.length] = name;
    }
    let names = "";
    for (const name of changed) names = names === "" ? name : names + "," + name;
    appendFileSync(report, (names === "" ? "ok " + nonce + " " + calls : "tampered " + nonce + " " + names) + "\n");
  });
}
`;

const pythonJudge = String.raw`import importlib.machinery as _machinery
import importlib.util as _importutil
import os as _os
import sys as _sys

# This file shadows the interpreter's own sitecustomize, so that one still runs first.
_here = _os.path.dirname(_os.path.abspath(__file__))
_others = [p for p in _sys.path if _os.path.abspath(p or ".") != _here]
_spec = _machinery.PathFinder.find_spec("sitecustomize", _others)
if _spec is not None and _spec.loader is not None:
    _spec.loader.exec_module(_importutil.module_from_spec(_spec))

_report = _os.environ.get("SWARM_JUDGE_REPORT")
if _report:
    import atexit as _atexit
    import builtins as _builtins
    import hashlib as _hashlib
    import secrets as _secrets
    import unittest as _unittest

    _nonce = _secrets.token_hex(16)
    _watched = []
    _missing = object()

    def _watch(label, holder, names):
        for name in names:
            value = vars(holder).get(name, _missing)
            if value is not _missing:
                _watched.append((label + "." + name, holder, name, value))

    _case = vars(_unittest.TestCase)
    _watch("unittest.TestCase", _unittest.TestCase, [n for n in _case if n.startswith(("assert", "fail", "run"))])
    _watch("builtins", _builtins, ["AssertionError", "isinstance", "len", "sorted", "repr", "str", "int", "float", "list", "dict", "set", "tuple", "all", "any", "abs", "round", "sum", "min", "max"])
    try:
        import _pytest.assertion.rewrite as _rewrite
        import _pytest.assertion.util as _util
        import _pytest.python as _python
        import _pytest.runner as _runner

        _watch("_pytest.python.Function", _python.Function, ["runtest"])
        _watch("_pytest.python", _python, ["pytest_pyfunc_call"])
        _watch("_pytest.runner", _runner, ["pytest_runtest_call", "call_and_report", "runtestprotocol"])
        _watch("_pytest.assertion.rewrite", _rewrite, [n for n in vars(_rewrite) if n.startswith("_call")])
        _watch("_pytest.assertion.util", _util, ["assertrepr_compare"])
    except ImportError:
        pass
    with open(_report, "a") as _out:
        _out.write("start " + _hashlib.sha256(_nonce.encode()).hexdigest() + "\n")

    def _judge():
        changed = [label for label, holder, name, value in _watched if vars(holder).get(name, _missing) is not value]
        line = "tampered %s %s" % (_nonce, ",".join(changed)) if changed else "ok %s 0" % _nonce
        with open(_report, "a") as out:
            out.write(line + "\n")

    _atexit.register(_judge)
`;

/** A digest of the judge's code, so a cached base run made by another judge is never reused. */
export const judgeSha256 = createHash("sha256")
  .update(nodeHooks)
  .update(nodeJudge)
  .update(pythonJudge)
  .digest("hex");

export interface Judge {
  /** The variables that load the judge into a check's Node and Python processes. */
  readonly env: Readonly<Record<string, string>>;
  readonly report: string;
}

/** Writes the judge into the run's scratch directory, outside the checkout `root`. */
export async function prepareJudge(scratch: string, name: string, root: string): Promise<Judge> {
  const dir = join(scratch, "judge");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [file, text] of [
    ["judge.mjs", nodeJudge],
    ["judge-hooks.mjs", nodeHooks],
    ["sitecustomize.py", pythonJudge],
  ] as const) {
    await rm(join(dir, file), { force: true });
    await writeFile(join(dir, file), text, { mode: 0o600 });
    await chmod(join(dir, file), 0o400);
  }
  const report = join(dir, `${name.replace(/[^\w.-]/g, "_")}-${Date.now()}.report`);
  return {
    report,
    env: {
      NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(join(dir, "judge.mjs")).href)}`,
      PYTHONPATH: dir,
      SWARM_JUDGE_REPORT: report,
      SWARM_JUDGE_ROOT: `${pathToFileURL(root).href}/`,
      SWARM_JUDGE_HOOKS: pathToFileURL(join(dir, "judge-hooks.mjs")).href,
    },
  };
}

export interface JudgeReading {
  /** Processes that loaded the judge. */
  readonly processes: number;
  /** Calls made through node:assert's functions (Python reports none). */
  readonly assertionCalls: number;
  /** What the code under test changed, or why the judge could not tell; null when clean. */
  readonly problem: string | null;
}

/**
 * Every process that started must end with its own nonce: a `tampered` line, or a start with
 * no end (a process killed, or one whose exit hooks were removed), is a problem.
 */
export async function readJudge(report: string): Promise<JudgeReading> {
  const lines = (await readFile(report, "utf8").catch(() => "")).split("\n");
  const open = new Set<string>();
  const changed = new Set<string>();
  let processes = 0;
  let assertionCalls = 0;
  for (const line of lines) {
    const [kind, value = "", detail = ""] = line.split(" ");
    if (kind === "start") {
      processes += 1;
      open.add(value);
      continue;
    }
    const started = createHash("sha256").update(value).digest("hex");
    if ((kind === "ok" || kind === "tampered") && open.has(started)) {
      open.delete(started);
      if (kind === "ok") assertionCalls += Number(detail) || 0;
      else for (const name of detail.split(",")) changed.add(name);
    }
  }
  const problem =
    changed.size > 0
      ? `the code under test changed ${[...changed].join(", ")}`
      : open.size > 0
        ? `${open.size} process(es) exited before the judge could check them`
        : null;
  return { processes, assertionCalls, problem };
}
