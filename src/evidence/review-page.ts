import type { BundleManifest } from "./bundle-manifest.ts";
import { canonicalJson } from "./canonical-json.ts";
import type { ClaimNode, EvidenceDag, EvidenceNode } from "./dag.ts";

/**
 * The reviewer's view: claims on the left, the records they cite on the right, anything
 * not harness-verified in red. Static and self-contained by design, since a review page
 * that needs a server is a review page nobody opens.
 */
export function renderReviewPage(manifest: BundleManifest, dag: EvidenceDag): string {
  const evidenceBySequence = new Map(dag.evidence.map((node) => [node.sequence, node]));
  const evidenceByDigest = new Map(dag.evidence.map((node) => [node.digest, node]));

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>swarm evidence bundle ${escapeHtml(manifest.sessionId)}</title>`,
    `<style>${styles}</style>`,
    "</head>",
    "<body>",
    renderHeader(manifest, dag),
    '<main class="columns">',
    '<section class="claims"><h2>Claims</h2>',
    dag.claims.length === 0
      ? '<p class="empty">This run made no structured claims.</p>'
      : dag.claims.map((claim) => renderClaim(claim, evidenceByDigest)).join("\n"),
    "</section>",
    '<section class="evidence"><h2>Evidence</h2>',
    dag.evidence.map((node) => renderEvidence(node)).join("\n"),
    "</section>",
    "</main>",
    renderFooter(manifest, evidenceBySequence.size),
    "</body>",
    "</html>",
  ].join("\n");
}

function renderHeader(manifest: BundleManifest, dag: EvidenceDag): string {
  const keyCaveat =
    manifest.signature.keySource === "ephemeral"
      ? "The signing key was generated for this run only, so it links nothing to a durable identity."
      : "The signing key is held in the OS keychain of the machine that produced this bundle.";

  return [
    "<header>",
    `<h1>swarm evidence bundle</h1>`,
    '<dl class="facts">',
    field("session", manifest.sessionId),
    field("exported", isoTime(manifest.exportedAt)),
    field("records", String(manifest.recordCount)),
    field("chain head", manifest.chainHead),
    field("claims verified", `${dag.verifiedCount} of ${dag.claims.length}`),
    "</dl>",
    '<p class="note">',
    "Green is computed by the harness: it means a machine-checkable predicate was evaluated ",
    "against the cited record and held. Model prose is never green. ",
    escapeHtml(keyCaveat),
    " A signature proves the bundle was not altered after it left that machine; it does not ",
    "prove the machine was honest while producing it.",
    "</p>",
    "</header>",
  ].join("");
}

function renderClaim(claim: ClaimNode, evidenceByDigest: Map<string, EvidenceNode>): string {
  const verified = claim.evaluation.verdict === "verified";
  const cited = claim.record === null ? undefined : evidenceByDigest.get(claim.record);

  return [
    `<article class="claim ${verified ? "verified" : "unverified"}">`,
    `<p class="verdict">${verified ? "VERIFIED" : "UNVERIFIED"}`,
    verified ? "" : `<span class="reason">${escapeHtml(claim.evaluation.reason ?? "")}</span>`,
    "</p>",
    `<pre class="predicate">${escapeHtml(claim.predicate || "(no predicate)")}</pre>`,
    '<p class="citation">',
    cited === undefined
      ? claim.record === null
        ? "cites no record"
        : `cites ${escapeHtml(claim.record)}, which is in no record of this chain`
      : `cites <a href="#record-${cited.sequence}">record ${cited.sequence}, ${escapeHtml(cited.type)}</a>`,
    claim.recordKind.length === 0 ? "" : `, asserted against ${escapeHtml(claim.recordKind)}`,
    "</p>",
    `<p class="detail">${escapeHtml(claim.evaluation.detail)}</p>`,
    claim.narrative.length === 0
      ? ""
      : `<blockquote class="prose"><span class="prose-label">unverified prose</span>${escapeHtml(claim.narrative)}</blockquote>`,
    "</article>",
  ].join("");
}

function renderEvidence(node: EvidenceNode): string {
  return [
    `<article class="record" id="record-${node.sequence}">`,
    `<p class="record-head"><span class="sequence">${node.sequence}</span>`,
    `<span class="type">${escapeHtml(node.type)}</span>`,
    `<span class="actor">${escapeHtml(node.actor)}</span>`,
    `<span class="time">${isoTime(node.timestamp)}</span></p>`,
    `<p class="summary">${escapeHtml(node.summary)}</p>`,
    `<p class="tags">provenance: ${node.provenance.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(" ") || "none"}</p>`,
    `<p class="digest">${escapeHtml(node.digest)}</p>`,
    node.payload === null
      ? '<p class="detail">the payload blob is absent from this bundle</p>'
      : `<details><summary>payload</summary><pre>${escapeHtml(prettyJson(node.payload))}</pre></details>`,
    "</article>",
  ].join("");
}

function renderFooter(manifest: BundleManifest, recordCount: number): string {
  return [
    "<footer>",
    "<p>Each tool-call record carries a derivation score: how much its arguments overlapped ",
    "content the model had recently read. That is a text-overlap heuristic with a ",
    "false-positive rate, not an information-flow guarantee, and a flagged call means ",
    "plausible influence rather than proven influence.</p>",
    `<p>${recordCount} evidence records. Verify this bundle without installing anything: `,
    "<code>node verify.mjs .</code> from this directory.</p>",
    `<p class="digest">signature ${escapeHtml(manifest.signature.algorithm)} over the chain head, `,
    `public key ${escapeHtml(manifest.signature.publicKey)}</p>`,
    "</footer>",
  ].join("");
}

function field(label: string, value: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function prettyJson(value: Parameters<typeof canonicalJson>[0]): string {
  return JSON.stringify(JSON.parse(canonicalJson(value)), null, 2);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const styles = `
:root { color-scheme: light dark; --ink: #16181d; --paper: #fbfbfa; --line: #d8d8d4;
  --green: #17683a; --red: #b3261e; --muted: #5f6368; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8e8e6; --paper: #16181d; --line: #33363d;
  --green: #6fd08c; --red: #ff8a80; --muted: #a0a4ab; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem; background: var(--paper); color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.4rem; margin: 0 0 .75rem; }
h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted);
  margin: 0 0 .75rem; }
header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; margin: 0 0 .75rem; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem;
  overflow-wrap: anywhere; }
.note { max-width: 78ch; color: var(--muted); margin: 0; }
.columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2rem; align-items: start; }
@media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }
article { border: 1px solid var(--line); border-radius: 6px; padding: .8rem 1rem; margin-bottom: .75rem;
  background: color-mix(in srgb, var(--paper) 92%, var(--ink) 8%); }
.claim.unverified { border-left: 4px solid var(--red); }
.claim.verified { border-left: 4px solid var(--green); }
.verdict { font-weight: 700; letter-spacing: .04em; margin: 0 0 .5rem; }
.claim.unverified .verdict { color: var(--red); }
.claim.verified .verdict { color: var(--green); }
.reason { font-weight: 400; color: var(--muted); margin-left: .5rem; font-size: .85rem; }
.predicate, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem;
  white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 .5rem; }
.citation, .detail, .summary, .tags, .digest { margin: 0 0 .4rem; font-size: .85rem; }
.digest { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .72rem; overflow-wrap: anywhere; }
.detail { color: var(--muted); }
.prose { margin: .5rem 0 0; padding: .5rem .75rem; border-left: 3px dashed var(--line);
  color: var(--muted); font-style: italic; }
.prose-label { display: block; font-style: normal; font-size: .68rem; text-transform: uppercase;
  letter-spacing: .08em; }
.record-head { margin: 0 0 .4rem; display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
.sequence { font-weight: 700; }
.type { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; }
.actor, .time { color: var(--muted); font-size: .78rem; }
.tag { border: 1px solid var(--line); border-radius: 999px; padding: 0 .5rem; font-size: .72rem; }
a { color: inherit; }
footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted);
  font-size: .85rem; }
.empty { color: var(--muted); }
`;
