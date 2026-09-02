/**
 * The seeded defects, as text transforms over one source line. Each operator finds the sites
 * it could apply to and applies one; whether a site is a defect is decided by the repository's
 * own suite, which has to pass before and fail after. Nothing here reads meaning: an operator
 * that lands inside a string or a comment produces a seed the suite does not notice, which the
 * oracle rejects, and that is the point of having the oracle.
 */

const commentPrefixes = ["//", "#", "*", "/*"];

function isComment(line) {
  const trimmed = line.trimStart();
  return commentPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

/** Flip one comparison operator: the boundary or the polarity, whichever the line offers first. */
const comparisonFlips = [
  [/ <= /, " < "],
  [/ >= /, " > "],
  [/ < /, " <= "],
  [/ > /, " >= "],
  [/ === /, " !== "],
  [/ !== /, " === "],
  [/ == /, " != "],
  [/ != /, " == "],
];

function flipComparison(line) {
  for (const [pattern, replacement] of comparisonFlips) {
    if (pattern.test(line)) {
      return line.replace(pattern, replacement);
    }
  }
  return null;
}

/** `+ 1` becomes `+ 2` and `- 1` becomes `- 2`: the classic boundary, moved by one. */
function offByOne(line) {
  const found = /([+-]) 1\b(?!\.)/.exec(line);
  if (found === null) {
    return null;
  }
  return `${line.slice(0, found.index)}${found[1]} 2${line.slice(found.index + found[0].length)}`;
}

/** Negate a whole `if` condition, in the spelling the language uses. */
const conditionShapes = [
  { pattern: /^(\s*)(else )?if \((.+)\) \{\s*$/, rewrite: (m) => `${m[1]}${m[2] ?? ""}if (!(${m[3]})) {` },
  { pattern: /^(\s*)(} else )?if (.+) \{\s*$/, rewrite: (m) => `${m[1]}${m[2] ?? ""}if !(${m[3]}) {` },
  { pattern: /^(\s*)(el)?if (.+):\s*$/, rewrite: (m) => `${m[1]}${m[2] ?? ""}if not (${m[3]}):` },
];

function negateCondition(line) {
  for (const shape of conditionShapes) {
    const found = shape.pattern.exec(line);
    if (found !== null && !/^\(?\s*(!|not\b)/.test(found[3])) {
      return shape.rewrite(found);
    }
  }
  return null;
}

/**
 * Drop a return that is the only statement of its block. In a braces language the block is
 * left empty; in Python it is left as `pass`, since an empty block is a syntax error there.
 */
function dropEarlyReturn(lines, index) {
  const line = lines[index];
  if (!/^\s*return\b/.test(line)) {
    return null;
  }
  const previous = lines
    .slice(0, index)
    .reverse()
    .find((candidate) => candidate.trim().length > 0);
  if (previous === undefined) {
    return null;
  }
  if (/\{\s*$/.test(previous)) {
    const next = lines.slice(index + 1).find((candidate) => candidate.trim().length > 0);
    return next !== undefined && next.trim().startsWith("}") ? "" : null;
  }
  if (/:\s*$/.test(previous)) {
    return line.replace(/return\b.*$/, "pass");
  }
  return null;
}

/** Swap the two arguments of a two-argument call, where they are plain names and differ. */
function swapArguments(line) {
  if (/\b(function|def|fn|func)\b/.test(line)) {
    return null;
  }
  const found = /\b([A-Za-z_][\w.]*)\(([A-Za-z_][\w.]*), ([A-Za-z_][\w.]*)\)/.exec(line);
  if (found === null || found[2] === found[3]) {
    return null;
  }
  return `${line.slice(0, found.index)}${found[1]}(${found[3]}, ${found[2]})${line.slice(found.index + found[0].length)}`;
}

const operators = Object.freeze({
  "flip-comparison": (lines, index) => flipComparison(lines[index]),
  "off-by-one": (lines, index) => offByOne(lines[index]),
  "negate-condition": (lines, index) => negateCondition(lines[index]),
  "drop-early-return": dropEarlyReturn,
  "swap-arguments": (lines, index) => swapArguments(lines[index]),
});

export const operatorNames = Object.freeze(Object.keys(operators));

/** Every site in the text one operator could apply to, in line order, as the change it would make. */
export function sitesFor(operator, text) {
  const apply = operators[operator];
  if (apply === undefined) {
    throw new Error(`no such mutation operator: ${operator}`);
  }
  const lines = text.split("\n");
  const sites = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0 || isComment(line)) {
      continue;
    }
    const after = apply(lines, index);
    if (after !== null && after !== line) {
      sites.push({ line: index + 1, before: line, after });
    }
  }
  return sites;
}

/** The text with exactly one site applied. */
export function applySite(text, site) {
  const lines = text.split("\n");
  if (lines[site.line - 1] !== site.before) {
    throw new Error(`line ${site.line} is not the line the site was found on`);
  }
  lines[site.line - 1] = site.after;
  return lines.join("\n");
}
