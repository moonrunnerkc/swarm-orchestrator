/**
 * The study's rows, as a directory of JSON files while they are being produced and as one
 * brotli archive once they are recorded: the archive is what the repository tracks (the tree
 * has a weight ceiling and fifty rows with their check outputs pass it), and every analysis
 * reads either form the same way. `unpack` restores the directory byte for byte.
 *
 * A run made under the versioned layout (a directory with `run.json`, see attempts.mjs) is read
 * the same way: each row is assembled from the standing attempt of each arm, with every
 * attempt's history beside it, and nothing in the run is rewritten. `assemble` writes that view
 * as `NN.json` files into a new directory (never over an existing file) so it can be packed.
 *
 *   node scripts/ai-pr-study/rows.mjs pack <rows directory> <rows.json.br>
 *   node scripts/ai-pr-study/rows.mjs unpack <rows.json.br> <rows directory>
 *   node scripts/ai-pr-study/rows.mjs assemble <run directory> <rows directory>
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { listAttempts, standingAttempt } from "./attempts.mjs";
import { childPath, writeFileInside } from "./containment.mjs";

const isRun = (source) => statSync(source).isDirectory() && existsSync(join(source, "run.json"));

/** The row indexes a run has any attempt for. */
function runIndexes(runDirectory) {
  const rows = join(runDirectory, "rows");
  if (!existsSync(rows)) return [];
  const indexes = new Set();
  for (const name of readdirSync(rows)) {
    const match = name.match(/^(\d+)\.[a-z0-9]+\.attempt-\d+/);
    if (match !== null) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((a, b) => a - b);
}

/**
 * One row of a run: the fetch arm's record at the top level, the suite arm's result as
 * `originalSuite` and `setup`, the verifier arm's fields, the adjudication and the A2 arm, each
 * from its standing attempt, and every arm's attempt history under `attempts`.
 */
export function assembleRow(runDirectory, index) {
  const rows = join(runDirectory, "rows");
  const manifest = JSON.parse(readFileSync(join(runDirectory, "run.json"), "utf8"));
  const arm = (name) => standingAttempt(listAttempts(rows, index, name));
  const fetch = arm("fetch");
  const suite = arm("suite");
  const verifier = arm("verifier");
  const adjudication = arm("adjudication");
  const a2 = arm("a2");
  const row = { runId: manifest.runId, index, ...(fetch.standing?.pr ?? {}) };
  if (fetch.standing?.failure) {
    row.outcome = "blocked";
    row.reason = fetch.standing.failure.reason;
  } else if (fetch.standing !== null) row.outcome = "fetched";
  if (suite.standing !== null) {
    row.originalSuite = suite.standing.originalSuite;
    row.setup = suite.standing.setup;
  }
  if (verifier.standing !== null) {
    for (const key of [
      "outcome",
      "reason",
      "verdict",
      "verifier",
      "report",
      "bundle",
      "evidence",
      "wallMs",
    ])
      if (verifier.standing[key] !== undefined) row[key] = verifier.standing[key];
  }
  if (adjudication.standing !== null) row.adjudication = adjudication.standing.adjudication;
  if (a2.standing !== null) row.comparisonA2 = a2.standing.comparisonA2;
  row.attempts = {
    fetch: fetch.history,
    suite: suite.history,
    verifier: verifier.history,
    adjudication: adjudication.history,
    a2: a2.history,
  };
  return row;
}

/** Every row, from a directory of `NN.json` files or from a `.json.br` archive of them. */
export function loadRows(source) {
  if (isRun(source)) return runIndexes(source).map((index) => assembleRow(source, index));
  if (statSync(source).isDirectory()) {
    return readdirSync(source)
      .filter((name) => /^\d+\.json$/.test(name))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(source, name), "utf8")));
  }
  const archive = JSON.parse(brotliDecompressSync(readFileSync(source)).toString("utf8"));
  return archive.rows.map((entry) => entry.row);
}

/** A digest over the rows' bytes, the same for the directory and for its archive. */
export function rowsDigest(source) {
  const hash = createHash("sha256");
  if (isRun(source)) {
    // Every file of the run's record, by name then bytes: the digest moves with any attempt.
    hash.update(readFileSync(join(source, "run.json")));
    const rows = join(source, "rows");
    for (const name of existsSync(rows) ? readdirSync(rows).sort() : []) {
      hash.update(`${name}\0`);
      hash.update(readFileSync(join(rows, name)));
    }
  } else if (statSync(source).isDirectory()) {
    for (const name of readdirSync(source)
      .filter((n) => /^\d+\.json$/.test(n))
      .sort())
      hash.update(readFileSync(join(source, name)));
  } else {
    const archive = JSON.parse(brotliDecompressSync(readFileSync(source)).toString("utf8"));
    for (const entry of archive.rows) hash.update(entry.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

const [mode, from, to] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}` && mode !== undefined) {
  if (mode === "pack") {
    const names = readdirSync(from)
      .filter((name) => /^\d+\.json$/.test(name))
      .sort();
    const rows = names.map((name) => {
      const bytes = readFileSync(join(from, name), "utf8");
      return { name, bytes, row: JSON.parse(bytes) };
    });
    writeFileSync(
      to,
      brotliCompressSync(JSON.stringify({ version: 1, kind: "ai-pr-study-rows", rows })),
    );
    console.log(`${rows.length} row(s) packed to ${to} (${statSync(to).size} bytes)`);
  } else if (mode === "unpack") {
    const archive = JSON.parse(brotliDecompressSync(readFileSync(from)).toString("utf8"));
    mkdirSync(to, { recursive: true });
    // Each name comes from the archive: one plain name in the directory, written without
    // following a symlink and never over an existing row.
    for (const entry of archive.rows) {
      childPath(to, entry.name);
      writeFileInside(to, entry.name, entry.bytes, { exclusive: true });
    }
    console.log(`${archive.rows.length} row(s) unpacked to ${to}`);
  } else if (mode === "assemble") {
    mkdirSync(to, { recursive: true });
    const indexes = runIndexes(from);
    for (const index of indexes) {
      const name = `${String(index).padStart(2, "0")}.json`;
      const written = writeFileInside(
        to,
        name,
        `${JSON.stringify(assembleRow(from, index), null, 2)}\n`,
        {
          exclusive: true,
        },
      );
      if (!written.written) {
        console.error(`${name} already exists in ${to}; assemble into a new directory`);
        process.exit(1);
      }
    }
    console.log(`${indexes.length} row(s) assembled from ${from} into ${to}`);
  } else {
    console.error(
      "usage: rows.mjs pack <rows directory> <rows.json.br> | unpack <rows.json.br> <rows directory> | assemble <run directory> <rows directory>",
    );
    process.exit(2);
  }
}
