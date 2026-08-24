/**
 * Renders the project page from the claims table, rather than from prose someone typed.
 *
 * The rule `docs/claims.md` states about itself is that a claim without a backing artifact
 * does not get made. A hand-written page is exactly where that rule goes to die: the table
 * gains a caveat, the page keeps the old sentence, and nobody notices because the two are
 * different files. So the page is generated. Every claim on it comes from a row of that
 * table, every forbidden phrase comes from the list underneath it, and the version comes
 * from `package.json`.
 *
 * Two typographic registers, because invariant 1 is the whole argument: a claim is prose and
 * a record is not. Claim text is set in a serif and carries no verdict colour. Anything the
 * harness computed, or any path you can go and read, is set in mono. The page cannot render
 * a green verdict, because it has none to render: what it offers instead is the artifact.
 *
 *   node scripts/build-site.mjs [output directory]
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const runGit = promisify(execFile);

const repositoryRoot = resolve(import.meta.dirname, "..");
const blobBase = "https://github.com/moonrunnerkc/swarm-orchestrator/blob/v13-main/";
const treeBase = "https://github.com/moonrunnerkc/swarm-orchestrator/tree/v13-main/";

/** Backing cells write paths relative to docs/, which is where claims.md sits. */
const claimsDirectory = "docs";

const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => escapes[character]);
}

/**
 * The rows of the claims table and the phrases the project forbids itself.
 *
 * Both halves matter. A page that published only the first half would be the marketing page
 * this project spent its history refusing to write.
 */
export function parseClaims(markdown) {
  const claimed = markdown.split("## What is claimed")[1] ?? "";
  const table = claimed.split("## What may not be said")[0] ?? "";

  const claims = [];
  for (const line of table.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.slice(1, -1).split(" | ");
    if (cells.length !== 2) continue;
    const [claim, backing] = cells.map((cell) => cell.trim());
    if (claim === "Claim" || claim.startsWith("---")) continue;
    claims.push({ claim, backing });
  }

  const forbidden = [];
  const banned = markdown.split("## What may not be said")[1] ?? "";
  for (const block of banned.split("\n- ").slice(1)) {
    const text = block.replace(/\n\s+/g, " ").trim();
    const phrase = text.match(/^\*\*(.+?)\.?\*\*/);
    forbidden.push({
      phrase: phrase ? phrase[1] : text.split(".")[0],
      reason: text.replace(/^\*\*.+?\*\*\s*/, ""),
    });
  }

  return { claims, forbidden };
}

/**
 * A path written in a backing cell, resolved to what it is in the repository.
 *
 * The cells use two spellings, both relative to docs/: `evidence/...` for a captured
 * artifact and `../src/...` for the mechanism. Anything that does not land on something git
 * tracks is left as text, because inventing a link to a file nobody committed is the defect
 * `scripts/check-doc-paths.mjs` exists to catch.
 */
export function resolveBackingPath(raw, tracked) {
  const cleaned = raw.replace(/\/$/, "");
  const candidate = relative(repositoryRoot, resolve(repositoryRoot, claimsDirectory, cleaned));
  if (candidate.startsWith("..")) return null;
  if (tracked.files.has(candidate)) return { path: candidate, href: blobBase + candidate };
  if (tracked.directories.has(candidate)) {
    return { path: candidate, href: treeBase + candidate, directory: true };
  }
  return null;
}

/** Every backtick path in a backing cell, deduplicated, in the order it is written. */
export function backingLinks(backing, tracked) {
  const links = new Map();
  for (const [, raw] of backing.matchAll(/`([^`\n]+)`/g)) {
    if (!raw.includes("/")) continue;
    const resolved = resolveBackingPath(raw, tracked);
    if (resolved && !links.has(resolved.path)) links.set(resolved.path, resolved);
  }
  return [...links.values()];
}

/**
 * Backing prose with its paths turned into links, so the sentence stays readable.
 *
 * A linked path is shown as what it is in the repository rather than as the `../` spelling
 * the cell uses, because the cell is written relative to docs/ and the reader is not.
 */
export function renderBacking(backing, tracked) {
  return escapeHtml(backing).replace(/`([^`\n]+)`/g, (_whole, raw) => {
    const resolved = raw.includes("/") ? resolveBackingPath(raw, tracked) : null;
    if (!resolved) return `<code>${escapeHtml(raw)}</code>`;
    const shown = resolved.directory ? `${resolved.path}/` : resolved.path;
    return `<a class="ref" href="${resolved.href}"><code>${escapeHtml(shown)}</code></a>`;
  });
}

function renderClaim(entry, tracked) {
  const links = backingLinks(entry.backing, tracked);
  const count = links.length === 1 ? "1 artifact" : `${links.length} artifacts`;
  return `<article class="claim">
  <p class="claim-text">${escapeHtml(entry.claim)}</p>
  <div class="backing">
    <p class="backing-label"><span>backing</span><span class="count">${count}</span></p>
    <p class="backing-text">${renderBacking(entry.backing, tracked)}</p>
  </div>
</article>`;
}

function renderForbidden(entry, tracked) {
  return `<li class="void-item">
  <p class="void-phrase">${escapeHtml(entry.phrase)}</p>
  <p class="void-reason">${renderBacking(entry.reason, tracked)}</p>
</li>`;
}

export function renderPage({ version, description, claims, forbidden, tracked }) {
  const claimRows = claims.map((entry) => renderClaim(entry, tracked)).join("\n");
  const voidRows = forbidden.map((entry) => renderForbidden(entry, tracked)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>swarm-orchestrator</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${styles()}
</style>
</head>
<body>
<div class="band" aria-hidden="true">${guilloche()}</div>

<header class="masthead">
  <p class="wordmark">swarm-orchestrator</p>
  <p class="issue"><span class="version">${escapeHtml(version)}</span><span class="sep">/</span><code>npm install -g swarm-orchestrator</code></p>
</header>

<main>
  <section class="hero">
    <h1>The model can say whatever it likes. It cannot make a gate pass, it cannot mark a claim verified, and it cannot change a record after the fact.</h1>
    <p class="standfirst">Those are the harness's to decide. A run exports a signed, hash-chained bundle that anybody can check without installing this tool.</p>

    <figure class="adjudication">
      <figcaption>One claim, twice refused, on a real run</figcaption>
      <div class="row">
        <p class="row-label">claim</p>
        <p class="row-record row-submitted">facts.exitCode == 0 &amp;&amp; facts.stdout.includes("8 harness(es), 84 seed(s) total")</p>
      </div>
      <div class="row">
        <p class="row-label">verdict</p>
        <p class="row-record"><span class="stamp">UNVERIFIED</span> predicate-unparseable: expected one of == != &gt;= &lt;= &gt; &lt; after "facts.stdout.includes"</p>
      </div>
      <div class="row">
        <p class="row-label">then</p>
        <p class="row-prose">the model wrote a predicate the harness could evaluate, and that one resolved.</p>
      </div>
      <p class="adjudication-source">Across the ten tasks of that run the harness rendered 11 claims verified and refused 42, in four distinct ways. None aborted a run. <a class="ref" href="${blobBase}docs/evidence/2026-08-18/shakedown/results.md"><code>docs/evidence/2026-08-18/shakedown/results.md</code></a></p>
    </figure>
  </section>

  <section class="ledger">
    <h2><span class="eyebrow">Every claim this project makes</span>and the committed thing that backs it</h2>
    <p class="lede">This list is generated from <a class="ref" href="${blobBase}docs/claims.md"><code>docs/claims.md</code></a>. Nothing reaches this page that is not a row of that table, which is the point: a claim without an artifact does not get made, and a page written by hand is where that rule quietly stops applying.</p>
    <div class="claims">
${claimRows}
    </div>
  </section>

  <section class="void">
    <h2><span class="eyebrow">And the sentences this project will not write</span>kept verbatim, because each was tempting once</h2>
    <ul class="void-list">
${voidRows}
    </ul>
  </section>

  <section class="check">
    <h2><span class="eyebrow">Check it yourself</span>the bundle carries its own verifier</h2>
    <pre><code>npm install -g swarm-orchestrator
swarm "make the parser trim before it splits"
node &lt;bundle&gt;/verify.mjs &lt;bundle&gt;</code></pre>
    <dl class="outcomes">
      <div><dt class="passed">exit 0</dt><dd>on the committed bundle</dd></div>
      <div><dt class="refused">exit 1</dt><dd>on the same bundle, one byte later</dd></div>
    </dl>
    <p>The verifier reads the manifest, walks the hash chain, checks the signature over the chain head, checks every blob against its content address, and recomputes every claim verdict. It needs nothing installed and nothing from this repository. Those two exit codes are from a <code>node:24</code> container with no network and no mount of the source. <a class="ref" href="${blobBase}docs/evidence/2026-08-23/clean-container-verification.md"><code>docs/evidence/2026-08-23/clean-container-verification.md</code></a></p>
    <p class="caveat">A signature does not make the machine honest. It proves the bundle was not altered after it left the machine that produced it. Gates prove mechanical quality, not design quality, and a passing run does not mean the change is good.</p>
  </section>
</main>

<footer>
  <p><a href="https://github.com/moonrunnerkc/swarm-orchestrator">Source</a><a href="https://www.npmjs.com/package/swarm-orchestrator">Package</a><a href="${blobBase}docs/build-guide.md">Design</a><a href="${blobBase}docs/tech-debt.md">Known debt</a></p>
  <p class="colophon">Page generated from <code>docs/claims.md</code> at ${escapeHtml(version)} by <code>scripts/build-site.mjs</code>. ISC licensed.</p>
</footer>
</body>
</html>
`;
}

/**
 * The band across the top is a guilloche, the interference pattern engraved on certificates
 * and banknotes because it is hard to reproduce. It is the one ornament here and it is the
 * right one: this is a page about whether a document can be trusted to be what it says.
 */
function guilloche() {
  const curves = [];
  for (let index = 0; index < 11; index += 1) {
    const phase = index * 9;
    const amplitude = 5 + index * 0.9;
    curves.push(
      `<path d="M0 ${14 + index * 0.4} q 15 -${amplitude} 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0" transform="translate(-${phase} 0)"/>`,
    );
  }
  return `<svg width="100%" height="34" viewBox="0 0 240 30" preserveAspectRatio="none" fill="none">
  <g stroke="currentColor" stroke-width="0.35" opacity="0.95">${curves.join("")}</g>
</svg>`;
}

function styles() {
  return `:root {
  --paper: #e3eae7;
  --paper-raised: #eef2f0;
  --ink: #141c22;
  --ink-soft: #5a6970;
  --rule: #b0c0bc;
  --passed: #16594a;
  --refused: #7c1f2c;
  --measure: 34rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #101619;
    --paper-raised: #171f23;
    --ink: #dfe7e4;
    --ink-soft: #8b9a9f;
    --rule: #2c383c;
    --passed: #6fc0a6;
    --refused: #d98b95;
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: Newsreader, Georgia, "Times New Roman", serif;
  font-size: 1.0625rem;
  line-height: 1.62;
  font-weight: 300;
  -webkit-font-smoothing: antialiased;
}

code, pre, .row-label, .row-record, .backing-label, .issue, .wordmark, .eyebrow, .count, .stamp {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

a { color: inherit; }

a.ref {
  text-decoration: none;
  border-bottom: 1px solid var(--rule);
}
a.ref:hover { border-bottom-color: var(--ink); }

code {
  font-size: 0.82em;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.band { color: var(--ink-soft); line-height: 0; opacity: 0.45; }

.masthead {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  align-items: baseline;
  justify-content: space-between;
  padding: 1.4rem clamp(1.25rem, 5vw, 4rem) 0;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 1.1rem;
}

.wordmark {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.issue {
  margin: 0;
  font-size: 0.78rem;
  color: var(--ink-soft);
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.issue .version { color: var(--ink); font-weight: 600; }
.issue .sep { opacity: 0.5; }

main { padding: 0 clamp(1.25rem, 5vw, 4rem); }

section { padding: clamp(3rem, 7vw, 5.5rem) 0; border-bottom: 1px solid var(--rule); }
section:last-of-type { border-bottom: 0; }

.hero { display: grid; row-gap: 1.4rem; column-gap: clamp(2.5rem, 5vw, 4rem); align-items: start; }

@media (min-width: 62rem) {
  .hero { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
  .hero h1 { grid-column: 1; }
  .standfirst { grid-column: 1; }
  .adjudication { grid-column: 2; grid-row: 1 / span 2; margin-top: 0.4rem; }
}

.hero h1 {
  font-family: "Instrument Serif", Georgia, serif;
  font-weight: 400;
  font-size: clamp(2.1rem, 5.4vw, 3.6rem);
  line-height: 1.06;
  letter-spacing: -0.012em;
  margin: 0;
  max-width: 20ch;
  text-wrap: balance;
}

.standfirst {
  margin: 0;
  max-width: var(--measure);
  color: var(--ink-soft);
  font-size: 1.0625rem;
}

.adjudication {
  margin: 0;
  padding: 1.5rem clamp(1.1rem, 3vw, 2rem);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  max-width: 46rem;
}

.adjudication figcaption {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-soft);
  padding-bottom: 1.1rem;
  margin-bottom: 1.1rem;
  border-bottom: 1px solid var(--rule);
}

.row { display: grid; grid-template-columns: 4.5rem 1fr; gap: 0.4rem 1rem; padding: 0.55rem 0; }

.row-label {
  margin: 0;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-soft);
  padding-top: 0.28rem;
}

.row-prose { margin: 0; color: var(--ink-soft); font-style: italic; overflow-wrap: anywhere; }

.row-submitted { color: var(--ink-soft); }

.row-record {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.stamp {
  display: inline-block;
  color: var(--refused);
  border: 1px solid currentColor;
  padding: 0.05rem 0.4rem;
  margin-right: 0.45rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  transform: rotate(-1.2deg);
}

.adjudication-source {
  margin: 1.3rem 0 0;
  padding-top: 1.1rem;
  border-top: 1px solid var(--rule);
  font-size: 0.9rem;
  color: var(--ink-soft);
}

h2 {
  margin: 0 0 1.4rem;
  font-family: "Instrument Serif", Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.5rem, 3.2vw, 2.1rem);
  line-height: 1.16;
  max-width: 26ch;
}

.eyebrow {
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin-bottom: 0.7rem;
}

.lede { max-width: var(--measure); color: var(--ink-soft); margin: 0 0 2.5rem; }

.claim {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem 3rem;
  padding: 1.6rem 0;
  border-top: 1px solid var(--rule);
  align-items: start;
}
.claim-text { margin: 0; font-size: 1.15rem; line-height: 1.42; text-wrap: pretty; }

.backing { min-width: 0; }

.backing-label {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin: 0 0 0.5rem;
  font-size: 0.66rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
.backing-label .count { opacity: 0.75; }

.backing-text { margin: 0; font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; }
.backing-text a.ref { color: var(--ink); }

.void-list { list-style: none; margin: 0; padding: 0; }

.void-item {
  padding: 1.4rem 0 1.4rem 1.6rem;
  border-top: 1px solid var(--rule);
  position: relative;
}
.void-item:last-child { border-bottom: 1px solid var(--rule); }

.void-item::before {
  content: "";
  position: absolute;
  left: 0;
  top: 1.4rem;
  bottom: 1.4rem;
  width: 3px;
  background: repeating-linear-gradient(
    -45deg,
    var(--refused) 0 2px,
    transparent 2px 5px
  );
}

.void-phrase {
  margin: 0 0 0.35rem;
  font-size: 1.1rem;
  color: var(--refused);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.void-reason { margin: 0; max-width: var(--measure); color: var(--ink-soft); font-size: 0.95rem; }

.check pre {
  margin: 0 0 1.6rem;
  max-width: 44rem;
  padding: 1.1rem 1.25rem;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.75;
}
.check pre code { font-size: 1em; font-weight: 400; }
.outcomes { margin: 0 0 1.6rem; display: flex; flex-wrap: wrap; gap: 0.5rem 2.5rem; }
.outcomes > div { display: flex; align-items: baseline; gap: 0.7rem; }
.outcomes dt {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  border: 1px solid currentColor;
  padding: 0.05rem 0.4rem;
}
.outcomes dt.passed { color: var(--passed); }
.outcomes dt.refused { color: var(--refused); }
.outcomes dd { margin: 0; font-size: 0.95rem; color: var(--ink-soft); }

.check p { max-width: var(--measure); margin: 0 0 1.1rem; }
.check .caveat { color: var(--ink-soft); font-size: 0.95rem; }

footer {
  padding: 2.2rem clamp(1.25rem, 5vw, 4rem) 3.5rem;
  border-top: 1px solid var(--rule);
  font-size: 0.82rem;
  color: var(--ink-soft);
}
footer p { margin: 0 0 0.6rem; display: flex; flex-wrap: wrap; gap: 1.4rem; }
footer a { text-decoration: none; border-bottom: 1px solid var(--rule); }
footer a:hover { border-bottom-color: var(--ink); }
footer .colophon { display: block; opacity: 0.8; }

:where(a, summary):focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 3px;
}

@media (max-width: 46rem) {
  .claim { grid-template-columns: minmax(0, 1fr); gap: 0.9rem; }
  .row { grid-template-columns: minmax(0, 1fr); gap: 0.15rem; }
  .row-label { padding-top: 0; }
}

@media (prefers-reduced-motion: no-preference) {
  .adjudication .stamp {
    animation: stamp 620ms cubic-bezier(0.2, 1.4, 0.4, 1) 700ms both;
  }
  @keyframes stamp {
    from { opacity: 0; transform: rotate(-9deg) scale(1.5); }
    to { opacity: 1; transform: rotate(-1.2deg) scale(1); }
  }
}
`;
}

/**
 * The address the previous site served, kept as an explanation rather than left to 404.
 *
 * That page was the v12 pull-request auditor's leaderboard, scored against a corpus this
 * repository no longer builds. Deploying over it is the point, but a reader who bookmarked
 * the old URL is owed a sentence about where it went, and a redirect would imply the two
 * pages are about the same product. They are not.
 */
export function renderRetirement() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Retired: the v12 leaderboard</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem;
  background: #e3eae7; color: #141c22;
  font: 400 1rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { body { background: #101619; color: #dfe7e4; } }
div { max-width: 34rem; }
p { margin: 0 0 1rem; }
a { color: inherit; }
</style>
</head>
<body>
<div>
<p>This address served the leaderboard of swarm-orchestrator 12, a pull-request auditor scored against a corpus this repository no longer builds.</p>
<p>Version 13 is a different program: a coding agent. The numbers that were here measured something it does not do, so they are not carried over and nothing here replaces them.</p>
<p><a href="/swarm-orchestrator/">What version 13 is, and what backs each claim it makes</a></p>
</div>
</body>
</html>
`;
}

async function trackedFromGit(root) {
  const { stdout } = await runGit("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const files = new Set(stdout.split("\0").filter(Boolean));
  const directories = new Set();
  for (const file of files) {
    let parent = dirname(file);
    while (parent && parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  return { files, directories };
}

export async function buildSite(outputDirectory) {
  const [claimsMarkdown, manifest, tracked] = await Promise.all([
    readFile(join(repositoryRoot, "docs", "claims.md"), "utf8"),
    readFile(join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    trackedFromGit(repositoryRoot),
  ]);

  const { claims, forbidden } = parseClaims(claimsMarkdown);
  if (claims.length === 0) throw new Error("claims.md yielded no rows; the page would say nothing");
  if (forbidden.length === 0) throw new Error("claims.md yielded no forbidden phrases");

  const html = renderPage({
    version: manifest.version,
    description: manifest.description,
    claims,
    forbidden,
    tracked,
  });

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "index.html"), html);

  const retired = join(outputDirectory, "docs", "leaderboard");
  await mkdir(retired, { recursive: true });
  await writeFile(join(retired, "index.html"), renderRetirement());

  return { claims: claims.length, forbidden: forbidden.length, bytes: html.length };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const output = resolve(process.argv[2] ?? join(repositoryRoot, "_site"));
  const summary = await buildSite(output);
  process.stdout.write(
    `${output}/index.html: ${summary.claims} claims, ${summary.forbidden} forbidden phrases, ${summary.bytes} bytes\n`,
  );
}
