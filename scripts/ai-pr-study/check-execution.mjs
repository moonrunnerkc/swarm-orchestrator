/**
 * What an acceptance check actually executes, decided from its command and its file rather than
 * from a pattern over their text. A check is `behavioural-executed` when some part of it imports
 * or runs the project's own code, `text-inspected` when every part only reads files (grep, test
 * -f, a script that opens a source file and matches strings in it), and `unscored` with a reason
 * when a part runs something this classifier cannot follow.
 *
 * The earlier report split the two by searching the command and the file for runner names, so
 * a bash script that grepped `icon-detail.tsx ` counted as behavioural (`tsx ` matched) and
 * `python -c "from safety... import"` counted as text-only (`python -c` did not). Here the command
 * is tokenised as a shell would split it, each simple command's program is looked up, and an
 * interpreter's code (the check file, an inline `-c`/`-e` string, or a shell script) is read for
 * the imports it actually makes.
 *
 * `projectModule(language, specifier)` answers whether an import names the project's own code;
 * given a checkout it is exact (see `checkoutModuleResolver`). Without one, a Python import that
 * is neither standard library nor a test framework, and a JavaScript import that is relative or
 * aliased, is taken as project code, and the result says the resolution was heuristic.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

export const TRUTH_CLASSES = ["behavioural-executed", "text-inspected", "unscored"];

// Programs that only read, compare, print or move text and files; none runs project code.
const textPrograms = new Set(
  (
    "grep egrep fgrep rg ag test [ [[ cat head tail wc diff cmp sed awk gawk find ls echo printf " +
    "exit true false set cd pushd popd export unset read sort uniq tr cut basename dirname " +
    "realpath readlink stat file jq yq tee sleep : local return shift declare typeset pwd " +
    "mkdir rm touch cp mv base64 sha256sum shasum md5sum xxd od strings nl paste comm join fold " +
    "rev column trap break continue let wait"
  ).split(" "),
);
const shellKeywords = new Set(
  "if then else elif fi for in do done while until case esac function ! { } ( ) ]] ]".split(" "),
);
// Wrappers whose next word is the real program.
const wrappers = new Set(["env", "command", "exec", "time", "nice", "nohup", "xargs", "timeout"]);

const pythonStandard = new Set(
  (
    "__future__ abc argparse array ast asyncio base64 bisect builtins calendar codecs collections " +
    "concurrent configparser contextlib copy csv dataclasses datetime decimal difflib dis doctest " +
    "email enum errno fnmatch fractions functools gc glob gzip hashlib heapq hmac html http " +
    "importlib inspect io ipaddress itertools json keyword locale logging math mimetypes " +
    "multiprocessing numbers operator os pathlib pickle platform pprint queue random re runpy " +
    "secrets shlex shutil signal socket sqlite3 stat statistics string struct subprocess sys " +
    "tarfile tempfile textwrap threading time timeit tokenize tomllib traceback types typing " +
    "unicodedata unittest urllib uuid warnings weakref xml zipfile zoneinfo"
  ).split(" "),
);
// Test frameworks and their helpers: importing them runs no project code.
const pythonTestLibraries = new Set(["pytest", "_pytest", "hypothesis", "mock", "pytest_asyncio"]);
const nodeBuiltins = new Set(
  (
    "assert buffer child_process crypto events fs fs/promises module os path process readline " +
    "stream string_decoder test timers url util worker_threads zlib http https net perf_hooks"
  ).split(" "),
);
const javascriptTestLibraries = new Set([
  "vitest",
  "jest",
  "@jest/globals",
  "mocha",
  "chai",
  "node:test",
]);

/**
 * Split a shell string into simple commands, each a list of words with quotes removed.
 * Command substitutions (`$(...)` and backticks) are returned as further shell strings, since
 * whatever they run is executed too.
 */
export function shellCommands(source) {
  const commands = [];
  const substitutions = [];
  const functions = new Set();
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  const append = (text) => {
    word = (word ?? "") + text;
  };
  const balanced = (start) => {
    // `start` is just after "$(": returns the index of the matching ")".
    let depth = 1;
    let quote = null;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (quote !== null) {
        if (char === "\\" && quote === '"') index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return source.length;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\" && source[index + 1] === "\n") {
      index += 1;
      continue;
    }
    if (char === "\\") {
      append(source[index + 1] ?? "");
      index += 1;
    } else if (char === "'") {
      const end = source.indexOf("'", index + 1);
      const stop = end === -1 ? source.length : end;
      append(source.slice(index + 1, stop));
      index = stop;
    } else if (char === '"') {
      let text = "";
      let cursor = index + 1;
      for (; cursor < source.length && source[cursor] !== '"'; cursor += 1) {
        if (source[cursor] === "\\" && cursor + 1 < source.length) {
          text += source[cursor + 1];
          cursor += 1;
        } else if (source.startsWith("$((", cursor)) {
          // Arithmetic expansion runs no command.
          cursor = balanced(cursor + 2);
          text += "$ARITHMETIC";
        } else if (source[cursor] === "$" && source[cursor + 1] === "(") {
          const end = balanced(cursor + 2);
          substitutions.push(source.slice(cursor + 2, end));
          text += "$SUBSTITUTION";
          cursor = end;
        } else text += source[cursor];
      }
      append(text);
      index = cursor;
    } else if (source.startsWith("$((", index)) {
      index = balanced(index + 2);
      append("$ARITHMETIC");
    } else if (word?.endsWith("=") && char === "(") {
      // An array assignment, `NAME=( a b c )`: its elements are words, not commands.
      const end = balanced(index + 1);
      append(source.slice(index, end + 1));
      index = end;
    } else if (char === "$" && source[index + 1] === "(") {
      const end = balanced(index + 2);
      substitutions.push(source.slice(index + 2, end));
      append("$SUBSTITUTION");
      index = end;
    } else if (char === "`") {
      const end = source.indexOf("`", index + 1);
      const stop = end === -1 ? source.length : end;
      substitutions.push(source.slice(index + 1, stop));
      append("$SUBSTITUTION");
      index = stop;
    } else if (char === "#" && word === null) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end - 1;
    } else if (char === "\n" || char === ";" || char === "&" || char === "|") {
      endCommand();
    } else if (char === "(" && source[index + 1] === ")") {
      // `name() {`: a function definition; its body is read where it stands, and a later call
      // by that name runs only what the body runs.
      endWord();
      if (words.length > 0) functions.add(words.at(-1));
      words = [];
      index += 1;
    } else if (char === "(" || char === ")") {
      endCommand();
    } else if (char === ">" || char === "<") {
      // A redirection: drop the operator and its target word.
      endWord();
      let cursor = index + 1;
      while (source[cursor] === ">" || source[cursor] === "&") cursor += 1;
      while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
      while (cursor < source.length && !/[\s;&|()]/.test(source[cursor])) cursor += 1;
      index = cursor - 1;
    } else if (char === " " || char === "\t") {
      endWord();
    } else {
      // A leading file-descriptor number of a redirection (`2>&1`) is not a word.
      if (
        /\d/.test(char) &&
        word === null &&
        (source[index + 1] === ">" || source[index + 1] === "<")
      )
        continue;
      append(char);
    }
  }
  endCommand();
  return { commands, substitutions, functions };
}

const isAssignment = (word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

/** Normalise a path the command names, relative to a working directory the command changed to. */
function joinPath(cwd, path) {
  const joined = posix.normalize(cwd === "" ? path : posix.join(cwd, path));
  return joined.replace(/^\.\//, "");
}

function pythonImports(code) {
  const modules = [];
  for (const match of code.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b/gm))
    modules.push(match[1]);
  for (const match of code.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm))
    for (const name of match[1].split(",")) modules.push(name.trim());
  for (const match of code.matchAll(/(?:import_module|__import__)\(\s*["']([\w.]+)["']/g))
    modules.push(match[1]);
  return modules;
}

function javascriptImports(code) {
  const specifiers = [];
  for (const match of code.matchAll(
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ))
    specifiers.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
  return specifiers;
}

function analysePython(code, projectModule) {
  const reasons = [];
  let project = false;
  let heuristic = false;
  for (const module of pythonImports(code)) {
    if (module.startsWith(".")) {
      project = true;
      reasons.push(`relative import ${module}`);
      continue;
    }
    const top = module.split(".")[0];
    if (pythonStandard.has(top) || pythonTestLibraries.has(top)) continue;
    const known = projectModule?.("python", module);
    if (known === true || known === undefined) {
      project = true;
      if (known === undefined) heuristic = true;
      reasons.push(`imports ${module}`);
    }
  }
  if (/\brunpy\.run_(path|module)\b|\bexec\s*\(\s*open\s*\(/.test(code)) {
    project = true;
    reasons.push("executes a project file");
  }
  if (project) return { kind: "project", detail: reasons.join(", "), heuristic };
  if (/\bsubprocess\.|\bos\.(system|popen|exec\w*)\s*\(/.test(code))
    return {
      kind: "unknown",
      detail: "starts a subprocess whose command this classifier does not follow",
    };
  return { kind: "text", detail: "Python that imports no project code" };
}

function analyseJavascript(code, projectModule) {
  const reasons = [];
  let project = false;
  let heuristic = false;
  for (const specifier of javascriptImports(code)) {
    const bare = specifier.replace(/^node:/, "");
    if (specifier.startsWith("node:") || nodeBuiltins.has(bare)) continue;
    if (javascriptTestLibraries.has(specifier)) continue;
    if (/^(\.{1,2}\/|\/|~\/|@\/|#)/.test(specifier) || specifier === "." || specifier === "..") {
      project = true;
      reasons.push(`imports ${specifier}`);
      continue;
    }
    const known = projectModule?.("javascript", specifier);
    if (known === true) {
      project = true;
      reasons.push(`imports the workspace package ${specifier}`);
    } else if (known === undefined && !/^@?[\w.-]+(\/[\w.-]+)*$/.test(specifier)) {
      project = true;
      heuristic = true;
      reasons.push(`imports ${specifier}`);
    }
  }
  if (project) return { kind: "project", detail: reasons.join(", "), heuristic };
  if (/\bchild_process\b|\bexecSync\b|\bspawnSync?\b|\bexecFile(Sync)?\b/.test(code))
    return {
      kind: "unknown",
      detail: "starts a subprocess whose command this classifier does not follow",
    };
  return { kind: "text", detail: "JavaScript that imports no project code" };
}

/**
 * Classify one check: `{ path, command, contents }` (the check file the reviewer wrote, the
 * command that runs it). Returns the class, the reason, and each unit that decided it.
 */
export function classifyCheckExecution(check, { projectModule } = {}) {
  const units = [];
  const definedFunctions = new Set();
  const checkPath = check.path ?? "";
  const bodyOf = (file, cwd) => {
    const joined = joinPath(cwd, file);
    if (joined === checkPath || (checkPath !== "" && checkPath.endsWith(`/${joined}`)))
      return check.contents ?? "";
    return null;
  };
  const language = (file) =>
    /\.py$/.test(file)
      ? "python"
      : /\.[cm]?[jt]sx?$/.test(file)
        ? "javascript"
        : /\.(sh|bash)$/.test(file)
          ? "shell"
          : null;
  const analyseBody = (lang, code, label, depth) => {
    if (lang === "python") units.push({ program: label, ...analysePython(code, projectModule) });
    else if (lang === "javascript")
      units.push({ program: label, ...analyseJavascript(code, projectModule) });
    else if (lang === "shell") analyseShell(code, depth + 1);
    else units.push({ program: label, kind: "unknown", detail: "a file of unknown language" });
  };
  const runFile = (file, cwd, lang, program, depth) => {
    const body = bodyOf(file, cwd);
    if (body === null)
      units.push({
        program,
        kind: "project",
        detail: `runs the project's own ${joinPath(cwd, file)}`,
      });
    else analyseBody(lang ?? language(file) ?? "shell", body, `${program} ${file}`, depth);
  };
  const testFiles = (args, cwd, lang, program, depth) => {
    const files = args.filter((arg) => !arg.startsWith("-") && arg !== "run");
    if (files.length === 0) {
      units.push({ program, kind: "project", detail: "runs the project's test suite" });
      return;
    }
    for (const file of files)
      runFile(file.split("::")[0], cwd, lang ?? language(file), program, depth);
  };
  const analyseProgram = (words, cwd, depth) => {
    let rest = words;
    while (rest.length > 0 && (isAssignment(rest[0]) || shellKeywords.has(rest[0])))
      rest = rest.slice(1);
    if (words[0] === "function" && words[1] !== undefined) {
      definedFunctions.add(words[1]);
      return cwd;
    }
    if (rest.length === 0) return cwd;
    // A loop or case header names variables and patterns, not programs.
    if (["for", "case", "select"].includes(words.find((word) => !isAssignment(word)) ?? ""))
      return cwd;
    let [program, ...args] = rest;
    while (wrappers.has(program)) {
      const next = args.findIndex(
        (arg) => !arg.startsWith("-") && !isAssignment(arg) && !/^\d+[smh]?$/.test(arg),
      );
      if (next === -1) return cwd;
      program = args[next];
      args = args.slice(next + 1);
    }
    const name = program.split("/").at(-1);
    if (definedFunctions.has(program)) return cwd;
    if (name === "cd") return args[0] === undefined ? cwd : joinPath(cwd, args[0]);
    if (textPrograms.has(name)) {
      units.push({ program: name, kind: "text", detail: "reads or compares text" });
      return cwd;
    }
    if (/^(bash|sh|zsh|dash)$/.test(name) || name === "source" || name === ".") {
      const inline = args.indexOf("-c");
      if (inline !== -1) analyseShell(args[inline + 1] ?? "", depth + 1);
      else {
        const file = args.find((arg) => !arg.startsWith("-"));
        if (file !== undefined) runFile(file, cwd, "shell", name, depth);
      }
      return cwd;
    }
    if (/^python(\d+(\.\d+)?)?$/.test(name)) {
      const inline = args.indexOf("-c");
      if (inline !== -1) {
        units.push({
          program: `${name} -c`,
          ...analysePython(args[inline + 1] ?? "", projectModule),
        });
        return cwd;
      }
      const moduleFlag = args.indexOf("-m");
      if (moduleFlag !== -1) {
        const module = args[moduleFlag + 1] ?? "";
        if (module === "pytest" || module === "unittest")
          testFiles(args.slice(moduleFlag + 2), cwd, "python", `${name} -m ${module}`, depth);
        else
          units.push({
            program: `${name} -m ${module}`,
            kind: projectModule?.("python", module) === false ? "unknown" : "project",
            detail: `runs the module ${module}`,
          });
        return cwd;
      }
      const file = args.find((arg) => !arg.startsWith("-"));
      if (file !== undefined) runFile(file, cwd, "python", name, depth);
      return cwd;
    }
    if (name === "pytest" || name === "py.test") {
      testFiles(args, cwd, "python", name, depth);
      return cwd;
    }
    if (name === "uv" || name === "poetry" || name === "pipenv") {
      const at = args.indexOf("run");
      if (at !== -1) {
        let tail = args.slice(at + 1);
        while (tail.length > 0 && tail[0].startsWith("-"))
          tail = tail.slice(tail[0] === "--with" ? 2 : 1);
        return analyseProgram(tail, cwd, depth);
      }
      units.push({ program: name, kind: "unknown", detail: `${name} without run` });
      return cwd;
    }
    if (/^(node|tsx|ts-node|bun)$/.test(name)) {
      const inline = args.findIndex((arg) => ["-e", "--eval", "-p", "--print"].includes(arg));
      if (inline !== -1) {
        units.push({
          program: `${name} -e`,
          ...analyseJavascript(args[inline + 1] ?? "", projectModule),
        });
        return cwd;
      }
      const valued = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);
      const files = [];
      for (let index = 0; index < args.length; index += 1) {
        if (valued.has(args[index])) index += 1;
        else if (!args[index].startsWith("-")) files.push(args[index]);
      }
      if (args.includes("--test")) testFiles(files, cwd, "javascript", `${name} --test`, depth);
      else if (files[0] !== undefined) runFile(files[0], cwd, "javascript", name, depth);
      return cwd;
    }
    if (
      name === "npx" ||
      name === "pnpx" ||
      (name === "pnpm" && args[0] === "exec") ||
      (name === "yarn" && args[0] === "exec")
    ) {
      let tail = name === "npx" || name === "pnpx" ? args : args.slice(1);
      while (tail.length > 0 && tail[0].startsWith("-"))
        tail = tail.slice(["--package", "-p"].includes(tail[0]) ? 2 : 1);
      return analyseProgram(tail, cwd, depth);
    }
    if (/^(vitest|jest|mocha)$/.test(name)) {
      testFiles(args, cwd, "javascript", name, depth);
      return cwd;
    }
    if (/^(npm|pnpm|yarn)$/.test(name)) {
      units.push({
        program: `${name} ${args.join(" ")}`.trim(),
        kind: "project",
        detail: "runs a project script",
      });
      return cwd;
    }
    if (name === "deno" && ["test", "run"].includes(args[0])) {
      testFiles(args.slice(1), cwd, "javascript", `deno ${args[0]}`, depth);
      return cwd;
    }
    if (
      (name === "go" && args[0] === "test") ||
      (name === "cargo" && args[0] === "test") ||
      (name === "dotnet" && args[0] === "test") ||
      name === "make"
    ) {
      units.push({
        program: `${name} ${args[0] ?? ""}`.trim(),
        kind: "project",
        detail: "builds and runs project code",
      });
      return cwd;
    }
    units.push({
      program: name,
      kind: "unknown",
      detail: `runs ${name}, which this classifier does not recognise`,
    });
    return cwd;
  };
  function analyseShell(source, depth) {
    if (depth > 6) {
      units.push({ program: "sh", kind: "unknown", detail: "shell nested too deeply to follow" });
      return;
    }
    const { commands, substitutions, functions } = shellCommands(source);
    for (const name of functions) definedFunctions.add(name);
    let cwd = "";
    for (const words of commands) cwd = analyseProgram(words, cwd, depth);
    for (const inner of substitutions) analyseShell(inner, depth + 1);
  }
  analyseShell(check.command ?? "", 0);
  const project = units.filter((unit) => unit.kind === "project");
  const unknown = units.filter((unit) => unit.kind === "unknown");
  const heuristic = project.some((unit) => unit.heuristic === true);
  if (project.length > 0)
    return {
      class: "behavioural-executed",
      reason: project.map((unit) => `${unit.program}: ${unit.detail}`).join("; "),
      resolution: heuristic ? "heuristic" : "exact",
      units,
    };
  if (unknown.length > 0)
    return {
      class: "unscored",
      reason: unknown.map((unit) => `${unit.program}: ${unit.detail}`).join("; "),
      resolution: "exact",
      units,
    };
  if (units.length === 0)
    return { class: "unscored", reason: "the command runs nothing", resolution: "exact", units };
  return {
    class: "text-inspected",
    reason: "every part of the check only reads or compares files",
    resolution: "exact",
    units,
  };
}

/**
 * An exact resolver over a checkout: a Python module is the project's when its top-level
 * package or module exists at the root or under src/, lib/ or python/; a bare JavaScript
 * specifier is the project's when it names the root package or a workspace package.
 */
export function checkoutModuleResolver(root) {
  const pythonRoots = ["", "src", "lib", "python"].map((dir) => join(root, dir));
  const packageNames = new Set();
  const readName = (file) => {
    try {
      const name = JSON.parse(readFileSync(file, "utf8")).name;
      if (typeof name === "string") packageNames.add(name);
    } catch {
      // A missing or unreadable manifest names no package.
    }
  };
  readName(join(root, "package.json"));
  for (const group of ["packages", "apps", "libs"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) readName(join(dir, entry, "package.json"));
  }
  return (language, specifier) => {
    if (language === "python") {
      const top = specifier.split(".")[0];
      return pythonRoots.some(
        (dir) =>
          existsSync(join(dir, `${top}.py`)) ||
          (existsSync(join(dir, top)) && statSync(join(dir, top)).isDirectory()),
      );
    }
    const name = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    return packageNames.has(name);
  };
}
